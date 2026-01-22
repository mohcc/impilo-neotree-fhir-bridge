import { ObservationResource } from "./types.js";
import type { NeonatalQuestionRow } from "../db/mysql.js";

export class ObservationMapper {
  constructor(private readonly clientId: string) {}
  
  map(row: NeonatalQuestionRow, patientResourceId: string): ObservationResource {
    // patientResourceId MUST come from OpenCR/SHR response - never use database IDs
    if (!patientResourceId) {
      throw new Error(`Patient resource ID is required for observation ${row.id}. Must be from OpenCR/SHR response.`);
    }
    
    let data: any;
    try {
      data = JSON.parse(row.data);
    } catch {
      data = {};
    }
    
    const value = this.extractValue(data, row.type, row.display_value);
    const effectiveDateTime = row.date_time_admission 
      ? this.formatDateTime(row.date_time_admission)
      : undefined;
    
    // Build category with both standard FHIR and custom codes
    const category = row.category_id ? this.buildCategory(row.category, row.category_id) : undefined;
    
    const observation: ObservationResource = {
      resourceType: "Observation",
      id: `neonatal-question-${row.id}`,
      status: "final",
      category,
      code: {
        coding: [{
          system: "urn:neotree:data-key",
          code: row.data_key,
          display: row.display_key || row.data_key
        }]
      },
      subject: {
        // Use ONLY the Patient resource ID from OpenCR/SHR response, never database ID
        reference: `Patient/${patientResourceId}`
      },
      effectiveDateTime,
      issued: new Date().toISOString(), // When the observation was made available
      ...value,
      extension: [
        {
          url: "urn:neotree:question-metadata",
          valueString: row.data
        },
        {
          url: "urn:neotree:neonatal-care-reference",
          valueReference: {
            reference: `Encounter/${row.neonatal_care_id}`
          }
        }
      ],
      meta: {
        tag: [{
          system: "http://openclientregistry.org/fhir/clientid",
          code: this.clientId
        }]
      }
    };
    
    return observation;
  }
  
  private extractValue(data: any, type: string, displayValue: string | null): Record<string, unknown> {
    const values = data?.values || [];
    const firstValue = values[0];
    
    if (!firstValue) {
      // Fallback to display_value if no value in JSON
      if (displayValue) {
        return { valueString: displayValue };
      }
      return {};
    }
    
    const value = firstValue.value;
    const valueText = firstValue.valueText || value;
    
    switch (type.toLowerCase()) {
      case "number":
        const numValue = typeof value === "number" ? value : parseFloat(String(value));
        if (!Number.isNaN(numValue)) {
          return { valueInteger: Math.round(numValue) };
        }
        return { valueString: String(valueText) };
        
      case "boolean":
        const boolValue = typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
        return { valueBoolean: boolValue };
        
      case "datetime":
      case "date":
        return { valueDateTime: this.formatDateTime(value) };
        
      case "id":
      case "string":
      default:
        // Handle multi-value responses (set<id>)
        if (values.length > 1) {
          return {
            component: values.map((v: any) => ({
              code: {
                coding: [{
                  code: v.value,
                  display: v.valueText || v.label
                }]
              },
              valueString: v.valueText || v.value
            }))
          };
        }
        return { valueString: String(valueText || value) };
    }
  }
  
  /**
   * Builds category array with both standard FHIR and custom codes
   */
  private buildCategory(categoryDisplay: string | null, categoryId: number): Array<{
    coding?: Array<{ system?: string; code?: string; display?: string }>;
  }> {
    const codings: Array<{ system?: string; code?: string; display?: string }> = [];
    
    // Add standard FHIR observation category code if we can map it
    const standardCode = this.mapToStandardCategory(categoryDisplay);
    if (standardCode) {
      codings.push({
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: standardCode.code,
        display: standardCode.display
      });
    }
    
    // Always add custom Neotree category code
    codings.push({
      system: "urn:neotree:question-category",
      code: String(categoryId),
      display: categoryDisplay || undefined
    });
    
    return [{ coding: codings }];
  }
  
  /**
   * Maps category display name to standard FHIR observation category code
   */
  private mapToStandardCategory(categoryDisplay: string | null): { code: string; display: string } | null {
    if (!categoryDisplay) return null;
    
    const normalized = categoryDisplay.toLowerCase().trim();
    
    // Map common category names to FHIR standard codes
    const categoryMap: Record<string, { code: string; display: string }> = {
      "vital signs": { code: "vital-signs", display: "Vital Signs" },
      "vitals": { code: "vital-signs", display: "Vital Signs" },
      "laboratory": { code: "laboratory", display: "Laboratory" },
      "lab": { code: "laboratory", display: "Laboratory" },
      "exam": { code: "exam", display: "Exam" },
      "examination": { code: "exam", display: "Exam" },
      "procedure": { code: "procedure", display: "Procedure" },
      "survey": { code: "survey", display: "Survey" },
      "therapy": { code: "therapy", display: "Therapy" },
      "activity": { code: "activity", display: "Activity" },
      "social-history": { code: "social-history", display: "Social History" },
      "imaging": { code: "imaging", display: "Imaging" }
    };
    
    // Check exact match first
    if (categoryMap[normalized]) {
      return categoryMap[normalized];
    }
    
    // Check partial matches
    for (const [key, value] of Object.entries(categoryMap)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return value;
      }
    }
    
    return null;
  }
  
  private formatDateTime(date: Date | string | null): string | undefined {
    if (!date) return undefined;
    
    let d: Date;
    if (typeof date === "string") {
      // If string is in MySQL format "YYYY-MM-DD HH:MM:SS" (UTC from database),
      // The database query converts from CAT (Zimbabwe time, UTC+2) to UTC before formatting
      // So this string is already in UTC - convert to ISO 8601 format with 'Z' suffix to indicate UTC
      const mysqlFormat = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
      if (mysqlFormat.test(date)) {
        // Replace space with 'T' and append 'Z' for UTC (accurate for Zimbabwe timezone handling)
        d = new Date(date.replace(' ', 'T') + 'Z');
      } else {
        d = new Date(date);
      }
    } else {
      d = date;
    }
    
    if (Number.isNaN(d.getTime())) return undefined;
    
    // Format as ISO 8601 (UTC)
    return d.toISOString();
  }
}



