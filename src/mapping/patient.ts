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
    // Order matters: NEOTREE-IMPILO-ID first (highest priority for matching), then patient_id
    const identifiers: Array<{ system: string; value: string }> = [];
    
    // Primary identifier: NEOTREE-IMPILO-ID (highest priority, unique identifier)
    // Format: PP-DD-SS-YYYY-P-XXXXX (e.g., 00-0A-34-2025-N-01031)
    if (row.neotree_id && String(row.neotree_id).trim()) {
      identifiers.push({
        system: "urn:neotree:impilo-id",
        value: String(row.neotree_id).trim()
      });
    }
    
    // Secondary identifier: patient_id (OpenCR expects urn:impilo:uid for internalid)
    if (row.patient_id) {
      identifiers.push({
        system: "urn:impilo:uid",
        value: String(row.patient_id)
      });
    }

    // Build managing organization reference
    const managingOrganization = row.facility_id
      ? { reference: `Organization/${row.facility_id}` }
      : undefined;

    // Build meta with client ID tag (required by OpenCR)
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
    const nameObj: { family?: string; given?: string[] } = {};
    if (row.lastname && String(row.lastname).trim()) {
      nameObj.family = String(row.lastname).trim();
    }
    if (given.length > 0) {
      nameObj.given = given;
    }

    return {
      resourceType: "Patient",
      ...(meta ? { meta } : {}),
      identifier: identifiers.length > 0 ? identifiers : undefined,
      name: [nameObj],
      gender,
      birthDate,
      managingOrganization,
    };
  }
}

function normalizeGender(sex: string | undefined): "male" | "female" | "other" | "unknown" | undefined {
  if (!sex) return undefined;
  const s = sex.toLowerCase();
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
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

