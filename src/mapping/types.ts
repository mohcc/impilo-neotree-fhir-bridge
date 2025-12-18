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

export interface ObservationResource extends FhirResource {
  resourceType: "Observation";
  id?: string;
  status: "registered" | "preliminary" | "final" | "amended" | "corrected" | "cancelled" | "entered-in-error" | "unknown";
  category?: Array<{
    coding?: Array<{ system?: string; code?: string; display?: string }>;
  }>;
  code: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
  };
  subject: {
    reference?: string;
  };
  effectiveDateTime?: string; // ISO 8601 datetime
  valueInteger?: number;
  valueString?: string;
  valueBoolean?: boolean;
  valueDateTime?: string;
  valueDate?: string;
  component?: Array<{
    code?: { coding?: Array<{ code?: string; display?: string }> };
    valueString?: string;
    valueInteger?: number;
  }>;
  extension?: Array<{
    url: string;
    valueString?: string;
    valueReference?: { reference?: string };
  }>;
  meta?: {
    tag?: Array<{ system?: string; code?: string }>;
  };
}

