import { OpenHimClient } from "../openhim/client.js";
import type { AppConfig } from "../config/index.js";

interface FhirBundle {
  resourceType: string;
  type?: string;
  total?: number;
  entry?: Array<{
    resource: FhirObservation;
  }>;
}

interface FhirObservation {
  resourceType: string;
  id?: string;
  status?: string;
  category?: Array<{
    coding?: Array<{ system?: string; code?: string; display?: string }>;
  }>;
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
  };
  subject?: {
    reference?: string;
  };
  effectiveDateTime?: string;
  issued?: string;
  valueInteger?: number;
  valueString?: string;
  valueBoolean?: boolean;
  valueDateTime?: string;
  valueDate?: string;
  component?: Array<unknown>;
  [key: string]: unknown;
}

export class ShrSearchClient {
  private readonly client: OpenHimClient;
  private readonly shrChannelPath: string;

  constructor(config: AppConfig) {
    this.client = new OpenHimClient(config);
    this.shrChannelPath = config.openhim.shrChannelPath;
  }

  /**
   * Check if identifier is a NEOTREE-IMPILO-ID format
   * Format: PP-DD-SS-YYYY-P-XXXXX (e.g., 09-0A-17-2026-N-00001)
   */
  private isNeotreeImpiloId(identifier: string): boolean {
    const neotreeIdRegex = /^[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}-\d{4}-[A-Za-z]-\d{5}$/;
    return neotreeIdRegex.test(identifier.trim());
  }

  /**
   * Check if identifier is a UUID format
   */
  private isUuid(identifier: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(identifier.trim());
  }

  /**
   * Search observations by patient identifier (supports multiple formats)
   * Supports:
   * - NEOTREE-IMPILO-ID (e.g., 09-0A-17-2026-N-00001)
   * - Patient UUID (e.g., 1550f344-a98e-4f35-be87-51fa821d6e18)
   * - Full identifier string (e.g., urn:impilo:patient-id|1550f344-a98e-4f35-be87-51fa821d6e18)
   */
  async searchObservationsByIdentifier(identifier: string): Promise<FhirObservation[]> {
    const trimmed = identifier.trim();
    
    // Build query based on identifier format
    let query: string;
    
    if (this.isNeotreeImpiloId(trimmed)) {
      // NEOTREE-IMPILO-ID format
      const encodedId = encodeURIComponent(`urn:neotree:impilo-id|${trimmed}`);
      query = `${this.shrChannelPath}/Observation?subject.identifier=${encodedId}`;
    } else if (this.isUuid(trimmed)) {
      // UUID format - try both identifier and direct subject reference
      const encodedId = encodeURIComponent(`urn:impilo:patient-id|${trimmed}`);
      query = `${this.shrChannelPath}/Observation?subject.identifier=${encodedId}`;
    } else if (trimmed.includes('|')) {
      // Full identifier format (e.g., urn:impilo:patient-id|xxx)
      const encodedId = encodeURIComponent(trimmed);
      query = `${this.shrChannelPath}/Observation?subject.identifier=${encodedId}`;
    } else {
      // Try as direct patient ID reference
      query = `${this.shrChannelPath}/Observation?subject=Patient/${trimmed}`;
    }
    
    return this.executeSearch(query);
  }

  /**
   * Search observations by patient ID (direct Patient reference)
   */
  async searchObservationsByPatient(patientId: string): Promise<FhirObservation[]> {
    const query = `${this.shrChannelPath}/Observation?subject=Patient/${patientId}`;
    return this.executeSearch(query);
  }

  /**
   * Search observations with additional filters
   */
  async searchObservations(
    identifier: string,
    filters?: {
      category?: string;
      code?: string;
      _lastUpdated?: string;
    }
  ): Promise<FhirObservation[]> {
    const trimmed = identifier.trim();
    
    // Build base query
    let query: string;
    
    if (this.isNeotreeImpiloId(trimmed)) {
      const encodedId = encodeURIComponent(`urn:neotree:impilo-id|${trimmed}`);
      query = `${this.shrChannelPath}/Observation?subject.identifier=${encodedId}`;
    } else if (this.isUuid(trimmed)) {
      const encodedId = encodeURIComponent(`urn:impilo:patient-id|${trimmed}`);
      query = `${this.shrChannelPath}/Observation?subject.identifier=${encodedId}`;
    } else if (trimmed.includes('|')) {
      const encodedId = encodeURIComponent(trimmed);
      query = `${this.shrChannelPath}/Observation?subject.identifier=${encodedId}`;
    } else {
      query = `${this.shrChannelPath}/Observation?subject=Patient/${trimmed}`;
    }
    
    // Add filters
    const queryParams: string[] = [];
    if (filters?.category) {
      queryParams.push(`category=${encodeURIComponent(filters.category)}`);
    }
    if (filters?.code) {
      queryParams.push(`code=${encodeURIComponent(filters.code)}`);
    }
    if (filters?._lastUpdated) {
      queryParams.push(`_lastUpdated=${encodeURIComponent(filters._lastUpdated)}`);
    }
    
    if (queryParams.length > 0) {
      query += `&${queryParams.join('&')}`;
    }
    
    return this.executeSearch(query);
  }

  /**
   * Get a specific observation by ID
   */
  async getObservation(observationId: string): Promise<FhirObservation | null> {
    try {
      const query = `${this.shrChannelPath}/Observation/${observationId}`;
      const result = await this.client.get(query);
      
      if (result.status === 200) {
        return result.body as FhirObservation;
      }
      
      return null;
    } catch (err) {
      console.error(`[SHR Search] Error getting observation ${observationId}:`, err);
      return null;
    }
  }

  /**
   * Execute search and return observations
   */
  private async executeSearch(searchUrl: string): Promise<FhirObservation[]> {
    try {
      const result = await this.client.get(searchUrl);
      
      if (result.status !== 200) {
        console.error(`[SHR Search] HTTP ${result.status} for: ${searchUrl}`);
        return [];
      }

      const bundle = result.body as FhirBundle;
      
      if (!bundle || bundle.resourceType !== "Bundle") {
        console.error(`[SHR Search] Unexpected response format for: ${searchUrl}`);
        return [];
      }
      
      if (!bundle.entry || bundle.entry.length === 0) {
        return [];
      }

      return bundle.entry.map(entry => entry.resource);
    } catch (err) {
      console.error(`[SHR Search] Error for URL: ${searchUrl}`, err);
      return [];
    }
  }
}

