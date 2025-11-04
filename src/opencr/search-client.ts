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
   * Search by NEOTREE-IMPILO-ID or Patient ID
   */
  async searchByIdentifier(identifier: string): Promise<SimplifiedPatient[]> {
    // Try both identifier systems
    const neotreeQuery = this.buildSearchUrl({
      identifier: `urn:neotree:impilo-id|${identifier}`
    });
    const patientIdQuery = this.buildSearchUrl({
      identifier: `urn:impilo:uid|${identifier}`
    });

    // Try NEOTREE-ID first
    const neotreeResult = await this.executeSearch(neotreeQuery);
    if (neotreeResult.length > 0) return neotreeResult;

    // Fall back to patient ID
    return this.executeSearch(patientIdQuery);
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
      const result = await this.client.get(searchUrl);
      
      if (result.status !== 200) {
        console.error(`[OpenCR Search] HTTP ${result.status}`);
        return [];
      }

      const bundle = result.body as FhirBundle;
      
      if (!bundle.entry || bundle.entry.length === 0) {
        return [];
      }

      return bundle.entry.map(entry => this.transformToSimplified(entry.resource));
    } catch (err) {
      console.error("[OpenCR Search] Error:", err);
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

