import { OpenHimClient } from "../openhim/client.js";
import { SearchParams, SimplifiedPatient } from "../api/types.js";
import type { AppConfig } from "../config/index.js";

interface FhirBundle {
  resourceType: string;
  type: string;
  total?: number;
  entry?: Array<{
    resource: FhirPatient;
  }>;
}

interface FhirPatient {
  resourceType: string;
  id: string;
  meta?: {
    tag?: Array<{ system: string; code: string }>;
  };
  identifier?: Array<{ system: string; value: string }>;
  name?: Array<{
    use?: string;
    family?: string;
    given?: string[];
  }>;
  gender?: string;
  birthDate?: string;
  managingOrganization?: {
    reference?: string;
  };
}

export class OpenCRSearchClient {
  private readonly client: OpenHimClient;
  private readonly channelPath: string;

  constructor(config: AppConfig) {
    this.client = new OpenHimClient(config);
    this.channelPath = config.openhim.channelPath;
  }

  /**
   * Check if identifier is a NEOTREE-IMPILO-ID format
   * Format: PP-DD-SS-YYYY-P-XXXXX (e.g., 01-0A-34-2025-N-76315)
   */
  private isNeotreeImpiloId(identifier: string): boolean {
    // NEOTREE-IMPILO-ID format: PP-DD-SS-YYYY-P-XXXXX
    // Example: 01-0A-34-2025-N-76315
    const neotreeIdRegex = /^[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}-\d{4}-[A-Za-z]-\d{5}$/;
    return neotreeIdRegex.test(identifier.trim());
  }

  /**
   * Search by NEOTREE-IMPILO-ID or Patient ID
   * Automatically detects identifier format and uses appropriate system
   */
  async searchByIdentifier(identifier: string): Promise<SimplifiedPatient[]> {
    const trimmed = identifier.trim();
    
    // Detect identifier format and use appropriate system
    if (this.isNeotreeImpiloId(trimmed)) {
      // It's a NEOTREE-IMPILO-ID format (e.g., 01-0A-34-2025-N-76315)
      const neotreeQuery = this.buildSearchUrl({
        identifier: `urn:neotree:impilo-id|${trimmed}`
      });
      const neotreeResult = await this.executeSearch(neotreeQuery);
      if (neotreeResult.length > 0) return neotreeResult;
      
      // Fall back to patient ID search in case it's stored differently
      const patientIdQuery = this.buildSearchUrl({
        identifier: `urn:impilo:uid|${trimmed}`
      });
      return this.executeSearch(patientIdQuery);
    } else {
      // It's a UUID or other format (e.g., 8ded5425-2b7e-47fc-974d-6a860dade244)
      // Only search with urn:impilo:uid
      const patientIdQuery = this.buildSearchUrl({
        identifier: `urn:impilo:uid|${trimmed}`
      });
      return this.executeSearch(patientIdQuery);
    }
  }

  /**
   * Search by demographics (name, DOB, gender)
   */
  async searchByDemographics(params: SearchParams): Promise<SimplifiedPatient[]> {
    const searchUrl = this.buildSearchUrl({
      given: params.given,
      family: params.family,
      birthDate: params.birthDate,
      gender: params.gender,
    });
    return this.executeSearch(searchUrl);
  }

  /**
   * Fuzzy search (for handling name variations)
   * Note: FHIR search itself doesn't support fuzzy matching directly,
   * but we can search with partial names and let OpenCR's matching rules handle it
   */
  async searchFuzzy(params: SearchParams): Promise<SimplifiedPatient[]> {
    // For fuzzy search, we use standard FHIR search but with more lenient parameters
    // OpenCR's matching algorithms will handle the fuzzy logic
    const searchUrl = this.buildSearchUrl({
      given: params.given,
      family: params.family,
      birthDate: params.birthDate,
    });
    return this.executeSearch(searchUrl);
  }

  /**
   * Flexible search with any combination of parameters
   */
  async search(params: SearchParams): Promise<SimplifiedPatient[]> {
    // If identifier provided, prioritize it
    if (params.identifier) {
      return this.searchByIdentifier(params.identifier);
    }

    // Otherwise, search by demographics
    const searchUrl = this.buildSearchUrl(params);
    return this.executeSearch(searchUrl);
  }

  /**
   * Build FHIR search URL with query parameters
   */
  private buildSearchUrl(params: Partial<SearchParams>): string {
    const queryParams: string[] = [];

    if (params.identifier) {
      queryParams.push(`identifier=${encodeURIComponent(params.identifier)}`);
    }
    if (params.given) {
      queryParams.push(`given=${encodeURIComponent(params.given)}`);
    }
    if (params.family) {
      queryParams.push(`family=${encodeURIComponent(params.family)}`);
    }
    if (params.birthDate) {
      queryParams.push(`birthdate=${encodeURIComponent(params.birthDate)}`);
    }
    if (params.gender) {
      queryParams.push(`gender=${encodeURIComponent(params.gender)}`);
    }

    const queryString = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
    return `${this.channelPath}/Patient${queryString}`;
  }

  /**
   * Execute search and transform FHIR Bundle to simplified patients
   */
  private async executeSearch(searchUrl: string): Promise<SimplifiedPatient[]> {
    try {
      const fullUrl = `${this.client.baseUrl}${searchUrl}`;
      console.log(`[OpenCR Search] Executing search: ${fullUrl}`);
      
      const result = await this.client.get(searchUrl);
      
      console.log(`[OpenCR Search] Response status: ${result.status}, URL: ${fullUrl}`);
      
      if (result.status !== 200) {
        console.error(`[OpenCR Search] HTTP ${result.status} for URL: ${fullUrl}`);
        return [];
      }

      const bundle = result.body as FhirBundle;
      
      if (!bundle.entry || bundle.entry.length === 0) {
        console.log(`[OpenCR Search] No results found for: ${fullUrl}`);
        return [];
      }

      console.log(`[OpenCR Search] Found ${bundle.entry.length} result(s) for: ${fullUrl}`);
      return bundle.entry.map(entry => this.transformToSimplified(entry.resource));
    } catch (err) {
      console.error(`[OpenCR Search] Error for URL: ${searchUrl}`, err);
      return [];
    }
  }

  /**
   * Transform FHIR Patient to simplified format
   */
  private transformToSimplified(fhirPatient: FhirPatient): SimplifiedPatient {
    // Extract identifiers
    const neotreeId = fhirPatient.identifier?.find(
      id => id.system === "urn:neotree:impilo-id"
    )?.value;
    
    const patientId = fhirPatient.identifier?.find(
      id => id.system === "urn:impilo:uid"
    )?.value;

    // Extract name
    const primaryName = fhirPatient.name?.[0];
    const givenName = primaryName?.given?.[0];
    const familyName = primaryName?.family;

    // Extract facility from managingOrganization or meta.tag
    const orgRef = fhirPatient.managingOrganization?.reference;
    const facility = orgRef ? orgRef.replace("Organization/", "") : undefined;

    // Extract source from meta.tag clientid
    const clientTag = fhirPatient.meta?.tag?.find(
      tag => tag.system === "http://openclientregistry.org/fhir/clientid"
    );
    const source = clientTag?.code;

    return {
      id: fhirPatient.id || "",
      identifiers: {
        neotreeId,
        patientId,
      },
      name: {
        given: givenName,
        family: familyName,
      },
      gender: fhirPatient.gender,
      birthDate: fhirPatient.birthDate,
      facility,
      source,
    };
  }
}

