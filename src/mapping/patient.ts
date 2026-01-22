import { Mapper, PatientResource, NeonatalCareRow } from "./types.js";

export class PatientMapper implements Mapper<NeonatalCareRow, PatientResource> {
  constructor(private readonly clientId?: string) {}
  
  map(row: NeonatalCareRow): PatientResource {
    const gender = normalizeGender(row.sex);
    const birthDate = normalizeBirthDate(row.birthdate);
    
    // Build name
    const given: string[] = [];
    if (row.firstname && String(row.firstname).trim()) {
      given.push(String(row.firstname).trim());
    }

    // Build identifiers
    // Order matters: phid (highest priority) > IMPILO-NEOTREE-ID > patient_id > person_id
    const identifiers: Array<{ system: string; value: string }> = [];
    
    // Primary identifier: phid (Primary Health ID) - HIGHEST PRIORITY
    // This is the most authoritative identifier from client.patient_identity table
    // Only include if available (LEFT JOIN may return null)
    if (row.phid && String(row.phid).trim()) {
      identifiers.push({
        system: "urn:impilo:phid",
        value: String(row.phid).trim()
      });
    }
    
    // Secondary identifier: IMPILO-NEOTREE-ID (high priority, unique identifier)
    // Format: PP-DD-SS-YYYY-P-XXXXX (e.g., 00-0A-34-2025-N-01031)
    if (row.impilo_neotree_id && String(row.impilo_neotree_id).trim()) {
      identifiers.push({
        system: "urn:neotree:impilo-id",
        value: String(row.impilo_neotree_id).trim()
      });
    }
    
    // Tertiary identifier: person_id (uniquely identifies a patient at one facility)
    if (row.person_id) {
      identifiers.push({
        system: "urn:impilo:person-id",
        value: String(row.person_id)
      });
      // Also add urn:impilo:uid mapped to person_id (required by OpenCR for internalid)
      identifiers.push({
        system: "urn:impilo:uid",
        value: String(row.person_id)
      });
    }

    // Build managing organization reference
    // Use configured clientId (from FACILITY_ID env var) if available, otherwise use row.facility_id
    const facilityId = this.clientId || row.facility_id;
    const managingOrganization = facilityId
      ? { reference: `Organization/${facilityId}` }
      : undefined;

    // Build meta with client ID tag (required by OpenCR)
    // This determines the "source" displayed in OpenCR CRUX
    const meta = this.clientId
      ? {
          tag: [
            {
              system: "http://openclientregistry.org/fhir/clientid",
              code: this.clientId,
            },
          ],
        }
      : undefined;

    // Build name object - ensure both family and given are present (not undefined)
    // OpenCR CRUX list view requires properly populated name fields
    // Include "use": "official" to match standard FHIR conventions
    const nameObj: { use?: string; family?: string; given?: string[] } = {
      use: "official"
    };
    if (row.lastname && String(row.lastname).trim()) {
      nameObj.family = String(row.lastname).trim();
    }
    if (given.length > 0) {
      nameObj.given = given;
    }

    // Build address array if address data exists
    const address = buildAddress(row);
    const addressArray = address ? [address] : undefined;

    return {
      resourceType: "Patient",
      ...(meta ? { meta } : {}),
      identifier: identifiers.length > 0 ? identifiers : undefined,
      name: [nameObj],
      gender,
      birthDate,
      ...(addressArray ? { address: addressArray } : {}),
      managingOrganization,
    };
  }
}

/**
 * Builds FHIR address object from database row
 * Maps client.person address fields to FHIR address structure
 * 
 * client.person fields:
 * - street: Street address
 * - city: City name
 * - town: Town name (alternative to city)
 * - country_of_birth: Country name
 */
function buildAddress(row: NeonatalCareRow): {
  use?: "home" | "work" | "temp" | "old" | "billing";
  type?: "postal" | "physical" | "both";
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
} | null {
  // Collect address lines from client.person fields
  const addressLines: string[] = [];
  
  // Add street address if it exists
  if (row.street && String(row.street).trim()) {
    addressLines.push(String(row.street).trim());
  }
  
  // If no address data at all, return null
  if (addressLines.length === 0 && 
      !row.city && !row.town && !row.country_of_birth) {
    return null;
  }

  // Build FHIR address object
  const fhirAddress: {
    use?: "home" | "work" | "temp" | "old" | "billing";
    type?: "postal" | "physical" | "both";
    line?: string[];
    city?: string;
    district?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } = {
    use: "home", // Default to home address
    type: "both", // Assume both postal and physical
  };

  // Add address lines if any
  if (addressLines.length > 0) {
    fhirAddress.line = addressLines;
  }

  // Add city (prefer city, fallback to town)
  if (row.city && String(row.city).trim()) {
    fhirAddress.city = String(row.city).trim();
  } else if (row.town && String(row.town).trim()) {
    fhirAddress.city = String(row.town).trim();
  }

  // Note: client.person doesn't have district/province/state/postal_code fields
  // These will be undefined/null if not available

  // Add country (use country_of_birth, default to Zimbabwe if not specified)
  if (row.country_of_birth && String(row.country_of_birth).trim()) {
    // Map country name to ISO code if needed
    const countryName = String(row.country_of_birth).trim();
    // If it's already a country code (2 letters), use it; otherwise try to map
    if (countryName.length === 2 && /^[A-Z]{2}$/i.test(countryName)) {
      fhirAddress.country = countryName.toUpperCase();
    } else if (countryName.toLowerCase().includes("zimbabwe")) {
      fhirAddress.country = "ZW"; // Zimbabwe ISO country code
    } else {
      // For other countries, use the name (FHIR allows country names)
      fhirAddress.country = countryName;
    }
  } else {
    fhirAddress.country = "ZW"; // Default to Zimbabwe ISO country code
  }

  return fhirAddress;
}

function normalizeGender(sex: string | undefined): "male" | "female" | "other" | "unknown" | undefined {
  if (!sex) return undefined;
  const s = sex.toLowerCase().trim();
  // Handle various formats: "M", "F", "MALE", "FEMALE", "m", "f", etc.
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
  // Handle "other" or "self_identified_gender" if needed
  if (s === "other" || s === "o") return "other";
  return "unknown";
}

function normalizeBirthDate(d: string | Date | undefined): string | undefined {
  if (!d) return undefined;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return undefined;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

