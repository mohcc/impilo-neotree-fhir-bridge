import { ObservationResource } from "./types.js";
import type { NeonatalQuestionRow } from "../db/mysql.js";

export class ObservationMapper {
  constructor(private readonly clientId: string) {}
  
  map(row: NeonatalQuestionRow, patientResourceId?: string): ObservationResource {
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
    
    const observation: ObservationResource = {
      resourceType: "Observation",
      id: `neonatal-question-${row.id}`,
      status: "final",
      category: row.category_id ? [{
        coding: [{
          system: "urn:neotree:question-category",
          code: String(row.category_id),
          display: row.category
        }]
      }] : undefined,
      code: {
        coding: [{
          system: "urn:neotree:data-key",
          code: row.data_key,
          display: row.display_key || row.data_key
        }]
      },
      subject: {
        reference: `Patient/${patientResourceId || row.patient_id}`
      },
      effectiveDateTime,
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
  
  private formatDateTime(date: Date | string | null): string | undefined {
    if (!date) return undefined;
    
    const d = typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return undefined;
    
    // Format as ISO 8601
    return d.toISOString();
  }
}



