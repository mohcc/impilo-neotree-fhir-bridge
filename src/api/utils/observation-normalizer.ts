/**
 * Observation Normalizer
 * 
 * Transforms observations from different sources (bridge, mobile) into a unified format.
 * The target format is the bridge format (current working implementation).
 */

// LOINC to Neotree code mapping
const LOINC_TO_NEOTREE: Record<string, { code: string; display: string; unit?: string }> = {
  // Vital Signs
  "8310-5": { code: "Temperature", display: "Temperature (oC)", unit: "Cel" },
  "8339-4": { code: "BirthWeight", display: "Birth Weight (g)", unit: "g" },
  "29463-7": { code: "CurrentWeight", display: "Current Weight (g)", unit: "g" },
  "8302-2": { code: "Length", display: "Length (cm)", unit: "cm" },
  "9843-4": { code: "OFC", display: "Head Circumference (cm)", unit: "cm" },
  "8867-4": { code: "HeartRate", display: "Heart Rate (bpm)", unit: "/min" },
  "9279-1": { code: "RespRate", display: "Respiratory Rate (bpm)", unit: "/min" },
  "2708-6": { code: "SpO2", display: "Oxygen Saturation (%)", unit: "%" },
  "8480-6": { code: "SystolicBP", display: "Systolic Blood Pressure (mmHg)", unit: "mm[Hg]" },
  "8462-4": { code: "DiastolicBP", display: "Diastolic Blood Pressure (mmHg)", unit: "mm[Hg]" },
  
  // Apgar Scores
  "9272-6": { code: "Apgar1", display: "Apgar score at 1 minute" },
  "9274-2": { code: "Apgar5", display: "Apgar score at 5 minute" },
  "9271-8": { code: "Apgar10", display: "Apgar score at 10 minute" },
  
  // Gestational Age
  "11884-4": { code: "GestationalAge", display: "Gestational Age (weeks)", unit: "wk" },
  "11885-1": { code: "GestationalAgeDays", display: "Gestational Age (days)", unit: "d" },
  
  // Blood Glucose
  "2339-0": { code: "BloodGlucose", display: "Blood Glucose (mmol/L)", unit: "mmol/L" },
  "2345-7": { code: "BloodGlucoseMass", display: "Blood Glucose (mg/dL)", unit: "mg/dL" },
};

// HL7 category to Neotree category mapping
const HL7_CATEGORY_TO_NEOTREE: Record<string, { id: string; display: string }> = {
  "vital-signs": { id: "66", display: "Vital Signs" },
  "laboratory": { id: "67", display: "Laboratory" },
  "exam": { id: "68", display: "Examination" },
  "survey": { id: "69", display: "Survey" },
  "procedure": { id: "70", display: "Procedure" },
  "therapy": { id: "71", display: "Therapy" },
  "activity": { id: "72", display: "Activity" },
  "social-history": { id: "73", display: "Social History" },
  "imaging": { id: "74", display: "Imaging" },
};

export type ObservationSource = "bridge" | "mobile" | "unknown";

export interface NormalizedObservation {
  id: string;
  source: ObservationSource;
  status: string;
  effectiveDateTime?: string;
  issued?: string;
  code: string;
  display: string;
  codeSystem: string;
  loincCode?: string;
  category: Array<{
    system: string;
    code: string;
    display?: string;
  }>;
  value: number | string | boolean | null;
  valueType: "integer" | "string" | "boolean" | "dateTime" | "date" | "quantity" | "component" | "unknown";
  unit?: string;
  subject: string;
  encounter?: string;
  extensions?: Array<{
    url: string;
    valueString?: string;
    valueReference?: { reference?: string };
  }>;
  components?: Array<unknown>;
  // Preserve original for debugging
  _originalCodeSystem?: string;
  _originalCode?: string;
}

/**
 * Detects the source of an observation based on its structure
 */
export function detectObservationSource(obs: any): ObservationSource {
  // Check for bridge markers
  const isBridge = 
    // Bridge IDs start with "neonatal-question-"
    obs.id?.startsWith("neonatal-question-") ||
    // Bridge uses urn:neotree:data-key code system
    obs.code?.coding?.some((c: any) => c.system === "urn:neotree:data-key") ||
    // Bridge has question-metadata extension
    obs.extension?.some((e: any) => e.url === "urn:neotree:question-metadata");

  if (isBridge) return "bridge";

  // Check for mobile markers
  const isMobile =
    // Mobile uses LOINC codes
    obs.code?.coding?.some((c: any) => c.system === "http://loinc.org") ||
    // Mobile has valueQuantity
    obs.valueQuantity !== undefined ||
    // Mobile has top-level encounter reference
    obs.encounter !== undefined ||
    // Mobile has observation identifier
    obs.identifier?.length > 0 ||
    // Mobile source contains "neotree-mobile"
    obs.meta?.source?.includes("neotree-mobile");

  if (isMobile) return "mobile";

  return "unknown";
}

/**
 * Extracts the encounter reference from observation
 */
function extractEncounter(obs: any): string | undefined {
  // First check top-level encounter (mobile format)
  if (obs.encounter?.reference) {
    return obs.encounter.reference;
  }
  
  // Then check extension (bridge format)
  const encounterExt = obs.extension?.find(
    (e: any) => e.url === "urn:neotree:neonatal-care-reference"
  );
  if (encounterExt?.valueReference?.reference) {
    return encounterExt.valueReference.reference;
  }
  
  return undefined;
}

/**
 * Extracts value from mobile observation (valueQuantity)
 */
function extractMobileValue(obs: any): { value: any; valueType: NormalizedObservation["valueType"]; unit?: string } {
  if (obs.valueQuantity !== undefined) {
    return {
      value: obs.valueQuantity.value,
      valueType: "quantity",
      unit: obs.valueQuantity.unit || obs.valueQuantity.code
    };
  }
  
  // Fallback to other value types (mobile might use these too)
  return extractBridgeValue(obs);
}

/**
 * Extracts value from bridge observation (primitive types)
 */
function extractBridgeValue(obs: any): { value: any; valueType: NormalizedObservation["valueType"]; unit?: string } {
  if (obs.valueInteger !== undefined) {
    return { value: obs.valueInteger, valueType: "integer" };
  }
  if (obs.valueString !== undefined) {
    return { value: obs.valueString, valueType: "string" };
  }
  if (obs.valueBoolean !== undefined) {
    return { value: obs.valueBoolean, valueType: "boolean" };
  }
  if (obs.valueDateTime !== undefined) {
    return { value: obs.valueDateTime, valueType: "dateTime" };
  }
  if (obs.valueDate !== undefined) {
    return { value: obs.valueDate, valueType: "date" };
  }
  if (obs.component && obs.component.length > 0) {
    return { value: "component", valueType: "component" };
  }
  
  return { value: null, valueType: "unknown" };
}

/**
 * Maps LOINC code to Neotree code
 */
function mapLoincToNeotree(loincCode: string): { code: string; display: string } | null {
  return LOINC_TO_NEOTREE[loincCode] || null;
}

/**
 * Maps HL7 category to Neotree category
 */
function mapHL7CategoryToNeotree(hl7Code: string): { id: string; display: string } | null {
  return HL7_CATEGORY_TO_NEOTREE[hl7Code] || null;
}

/**
 * Extracts and normalizes category from observation
 */
function extractCategory(obs: any, source: ObservationSource): NormalizedObservation["category"] {
  const categories: NormalizedObservation["category"] = [];
  
  if (!obs.category || obs.category.length === 0) {
    return categories;
  }
  
  for (const cat of obs.category) {
    if (!cat.coding) continue;
    
    for (const coding of cat.coding) {
      // If it's an HL7 category (from mobile), try to add Neotree equivalent
      if (coding.system === "http://terminology.hl7.org/CodeSystem/observation-category") {
        // Add the HL7 category
        categories.push({
          system: coding.system,
          code: coding.code,
          display: coding.display
        });
        
        // Also add mapped Neotree category
        const neotreeCat = mapHL7CategoryToNeotree(coding.code);
        if (neotreeCat) {
          categories.push({
            system: "urn:neotree:question-category",
            code: neotreeCat.id,
            display: neotreeCat.display
          });
        }
      }
      // If it's a Neotree category (from bridge), keep as-is
      else if (coding.system === "urn:neotree:question-category") {
        categories.push({
          system: coding.system,
          code: coding.code,
          display: coding.display
        });
      }
      // Other systems - include them
      else {
        categories.push({
          system: coding.system,
          code: coding.code,
          display: coding.display
        });
      }
    }
  }
  
  return categories;
}

/**
 * Normalizes an observation from any source to the unified format
 */
export function normalizeObservation(obs: any): NormalizedObservation {
  const source = detectObservationSource(obs);
  
  // Extract code information
  let code: string = "";
  let display: string = "";
  let codeSystem: string = "";
  let loincCode: string | undefined;
  let originalCode: string | undefined;
  let originalCodeSystem: string | undefined;
  
  if (obs.code?.coding && obs.code.coding.length > 0) {
    const primaryCoding = obs.code.coding[0];
    originalCode = primaryCoding.code;
    originalCodeSystem = primaryCoding.system;
    
    if (source === "mobile" && primaryCoding.system === "http://loinc.org") {
      // Mobile observation with LOINC - try to map to Neotree
      loincCode = primaryCoding.code;
      const neotreeMapping = mapLoincToNeotree(primaryCoding.code);
      
      if (neotreeMapping) {
        code = neotreeMapping.code;
        display = neotreeMapping.display;
        codeSystem = "urn:neotree:data-key";
      } else {
        // No mapping - use LOINC code as-is
        code = primaryCoding.code;
        display = primaryCoding.display || obs.code.text || primaryCoding.code;
        codeSystem = "http://loinc.org";
      }
    } else {
      // Bridge observation or unknown - use as-is
      code = primaryCoding.code;
      display = primaryCoding.display || primaryCoding.code;
      codeSystem = primaryCoding.system || "unknown";
    }
  }
  
  // Extract value based on source
  const { value, valueType, unit } = source === "mobile" 
    ? extractMobileValue(obs)
    : extractBridgeValue(obs);
  
  // Extract category
  const category = extractCategory(obs, source);
  
  // Extract encounter
  const encounter = extractEncounter(obs);
  
  // Extract subject
  const subject = obs.subject?.reference || "";
  
  // Build normalized observation
  const normalized: NormalizedObservation = {
    id: obs.id,
    source,
    status: obs.status || "unknown",
    effectiveDateTime: obs.effectiveDateTime,
    issued: obs.issued,
    code,
    display,
    codeSystem,
    loincCode,
    category,
    value,
    valueType,
    unit,
    subject,
    encounter,
    _originalCodeSystem: originalCodeSystem,
    _originalCode: originalCode,
  };
  
  // Include extensions if present
  if (obs.extension && obs.extension.length > 0) {
    normalized.extensions = obs.extension;
  }
  
  // Include components if present
  if (obs.component && obs.component.length > 0) {
    normalized.components = obs.component;
  }
  
  return normalized;
}

/**
 * Transforms normalized observation to API response format
 * This matches the current bridge output format
 */
export function toApiResponse(normalized: NormalizedObservation): Record<string, unknown> {
  const response: Record<string, unknown> = {
    id: normalized.id,
    source: normalized.source,
    status: normalized.status,
    effectiveDateTime: normalized.effectiveDateTime,
    issued: normalized.issued,
    code: normalized.code,
    display: normalized.display,
  };
  
  // Include LOINC code if available (for reference)
  if (normalized.loincCode) {
    response.loincCode = normalized.loincCode;
  }
  
  // Category
  if (normalized.category.length > 0) {
    response.category = normalized.category;
  }
  
  // Value - convert quantity to integer if applicable
  if (normalized.valueType === "quantity" && typeof normalized.value === "number") {
    // Round to integer for consistency with bridge format
    response.value = Math.round(normalized.value);
    response.valueType = "integer";
    // Preserve unit information
    if (normalized.unit) {
      response.unit = normalized.unit;
    }
  } else if (normalized.valueType === "component") {
    response.value = "component";
    response.valueType = "component";
    response.components = normalized.components;
  } else {
    response.value = normalized.value;
    response.valueType = normalized.valueType;
  }
  
  // Subject
  if (normalized.subject) {
    response.subject = normalized.subject;
  }
  
  // Encounter
  if (normalized.encounter) {
    response.encounter = normalized.encounter;
  }
  
  // Extensions
  if (normalized.extensions && normalized.extensions.length > 0) {
    response.extensions = normalized.extensions;
  }
  
  return response;
}
