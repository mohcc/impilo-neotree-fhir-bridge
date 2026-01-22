// API types for patient search functionality

export type DuplicateRisk = "none" | "low" | "medium" | "high";

export interface SearchParams {
  identifier?: string;      // NEOTREE-IMPILO-ID or Patient ID
  given?: string;           // Given name
  family?: string;          // Family name
  birthDate?: string;       // YYYY-MM-DD
  gender?: "male" | "female" | "other" | "unknown";
  threshold?: number;       // For fuzzy search (0-1, Jaro-Winkler)
}

export interface SimplifiedPatient {
  id: string;                                    // FHIR resource ID
  identifiers: {
    phid?: string;                               // Primary Health ID (urn:impilo:phid) - e.g., 203A2814
    neotreeId?: string;                          // NEOTREE-IMPILO-ID
    patientId?: string;                          // Patient ID (urn:impilo:patient-id)
    personId?: string;                           // Person ID (urn:impilo:person-id)
  };
  name: {
    given?: string;                              // First given name
    family?: string;                             // Family name
  };
  gender?: string;
  birthDate?: string;
  facility?: string;                             // Facility/Organization ID
  source?: string;                               // Source system name
  matchScore?: number;                           // OpenCR match score if available
}

export interface SearchResponse {
  query: SearchParams;                           // What was searched
  found: boolean;                                // Any matches found
  count: number;                                 // Number of matches
  confidence: "high" | "medium" | "low";        // Match confidence
  duplicateRisk: DuplicateRisk;                 // Risk assessment
  patients: SimplifiedPatient[];                // Matching patients
  message?: string;                              // Optional message
}

export type SearchType = "identifier" | "demographics" | "fuzzy" | "flexible";

