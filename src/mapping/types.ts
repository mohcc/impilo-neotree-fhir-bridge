import type { NeonatalCareWithDemographics } from "../db/mysql.js";

export type FhirResource = Record<string, unknown>;

export interface PatientResource extends FhirResource {
  resourceType: "Patient";
  id?: string;
  meta?: {
    tag?: Array<{ system?: string; code?: string; display?: string }>;
    source?: string;
  };
  identifier?: Array<{ system?: string; value?: string }>;
  name?: Array<{ use?: string; family?: string; given?: string[] }>;
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string; // YYYY-MM-DD
  managingOrganization?: { reference?: string };
}

export type RowObject = Record<string, unknown>;

// NeonatalCareRow is the input type for PatientMapper
export type NeonatalCareRow = NeonatalCareWithDemographics;

export interface Mapper<TInput extends RowObject, TOutput extends FhirResource> {
  map(input: TInput): TOutput;
}

