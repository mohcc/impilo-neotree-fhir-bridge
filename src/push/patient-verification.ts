import { OpenCRSearchClient } from "../opencr/search-client.js";
import { logger } from "../observability/logger.js";
import type { AppConfig } from "../config/index.js";
import { OpenHimClient } from "../openhim/client.js";

interface FhirPatient {
  resourceType: string;
  id?: string;
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
    type?: string;
    display?: string;
  };
  link?: Array<{
    other?: {
      reference?: string;
      type?: string;
    };
    type?: string;
  }>;
  meta?: {
    tag?: Array<{ system: string; code: string }>;
    versionId?: string;
    lastUpdated?: string;
  };
  [key: string]: unknown; // Allow other fields
}

/**
 * Verifies if a patient exists in OpenCR and ensures it exists in SHR
 * 
 * Flow:
 * 1. Verify patient exists in OpenCR (master registry)
 * 2. Check if Patient exists in SHR
 * 3. If NOT FOUND in SHR: Create Patient in SHR first (from OpenCR)
 * 4. Return SHR Patient resource ID
 */
export class PatientVerificationService {
  private readonly searchClient: OpenCRSearchClient;
  private readonly opencrClient: OpenHimClient;
  private readonly shrClient: OpenHimClient;
  private readonly opencrChannelPath: string;
  private readonly shrChannelPath: string;

  constructor(config: AppConfig) {
    this.searchClient = new OpenCRSearchClient(config);
    this.opencrClient = new OpenHimClient(config);
    this.shrClient = new OpenHimClient(config);
    this.opencrChannelPath = config.openhim.channelPath;
    this.shrChannelPath = config.openhim.shrChannelPath;
  }

  /**
   * Verify patient exists in OpenCR and ensure it exists in SHR
   * 
   * Flow:
   * 1. Verify patient exists in OpenCR (master registry)
   * 2. Check if Patient exists in SHR
   * 3. If NOT FOUND in SHR: Create Patient in SHR first (from OpenCR)
   * 4. Return SHR Patient resource ID
   * 
   * Returns the SHR Patient resource ID if found/created, null otherwise
   */
  async verifyPatientExists(patientId: string): Promise<string | null> {
    try {
      // Step 1: Verify patient exists in OpenCR (master registry)
      const opencrPatients = await this.searchClient.searchByIdentifier(patientId);
      if (opencrPatients.length === 0) {
        logger.debug(
          { patientId, foundIn: "OpenCR" },
          "Patient not found in OpenCR"
        );
        return null;
      }

      const opencrPatientId = opencrPatients[0]!.id;
      logger.debug(
        { patientId, foundIn: "OpenCR", opencrPatientId },
        "Patient verified in OpenCR"
      );

      // Step 2: Check if Patient exists in SHR
      // Note: patientId from neonatal_question is a UUID (patient_id), not a NEOTREE-IMPILO-ID
      // NEOTREE-IMPILO-ID format: 00-0A-34-2025-N-01031
      // UUID format: 8ded5425-2b7e-47fc-974d-6a860dade244
      // Only search with urn:impilo:uid since we have a UUID, not a NEOTREE-IMPILO-ID
      // URL encode the pipe character (%7C) and the patient ID
      const encodedPatientId = encodeURIComponent(patientId);
      const patientIdQuery = `${this.shrChannelPath}/Patient?identifier=urn:impilo:uid%7C${encodedPatientId}`;

      // Search with patient ID (UUID)
      const result = await this.shrClient.get(patientIdQuery);
      if (result.status === 200) {
        const bundle = result.body as { entry?: Array<{ resource: { id: string } }> };
        if (bundle.entry && bundle.entry.length > 0) {
          const shrPatientResourceId = bundle.entry[0]!.resource.id;
          logger.debug(
            { 
              patientId, 
              opencrPatientId,
              shrPatientResourceId, 
              foundIn: "SHR", 
              identifierType: "patient-id" 
            },
            "Patient found in SHR (verified in OpenCR)"
          );
          return shrPatientResourceId;
        }
      }

      // Step 3: Patient NOT FOUND in SHR - Create it from OpenCR
      logger.info(
        { 
          patientId, 
          opencrPatientId,
          foundIn: "SHR" 
        },
        "Patient exists in OpenCR but not in SHR - Creating Patient in SHR"
      );

      // Get full Patient resource from OpenCR
      const opencrPatientResult = await this.opencrClient.get(`${this.opencrChannelPath}/Patient/${opencrPatientId}`);
      if (opencrPatientResult.status !== 200) {
        logger.error(
          { patientId, opencrPatientId, status: opencrPatientResult.status },
          "Failed to fetch Patient resource from OpenCR"
        );
        return null;
      }

      const opencrPatient = opencrPatientResult.body as FhirPatient;
      
      // Prepare Patient for SHR
      // Remove OpenCR-specific fields and cross-references that won't exist in SHR
      // SHR is a separate database, so OpenCR resource IDs (Organizations, linked Patients, etc.) don't exist there
      const shrPatient: FhirPatient = {
        resourceType: "Patient",
        // Keep identifiers (these are universal, not resource-specific)
        identifier: opencrPatient.identifier,
        // Keep name (no cross-references)
        name: opencrPatient.name,
        // Keep gender (no cross-references)
        gender: opencrPatient.gender,
        // Keep birthDate (no cross-references)
        birthDate: opencrPatient.birthDate,
        // Remove id - let SHR assign a new one
        // Remove managingOrganization - Organization reference from OpenCR won't exist in SHR
        // Remove link - cross-references to other OpenCR Patients won't exist in SHR
        // Remove meta - OpenCR-specific metadata (versionId, lastUpdated, tags)
        // Keep only core patient data that doesn't reference other OpenCR resources
      };

      logger.debug(
        {
          patientId,
          opencrPatientId,
          removedFields: {
            id: !!opencrPatient.id,
            managingOrganization: !!opencrPatient.managingOrganization,
            link: !!opencrPatient.link,
            meta: !!opencrPatient.meta
          }
        },
        "Cleaned Patient resource for SHR (removed OpenCR cross-references)"
      );

      // POST Patient to SHR
      const createResult = await this.shrClient.postResource(`${this.shrChannelPath}/Patient`, shrPatient);
      
      if (createResult.status >= 200 && createResult.status < 300) {
        // Extract Patient resource ID from response
        let shrPatientResourceId: string | null = null;
        
        // Try to get ID from response body (FHIR Patient resource)
        if (createResult.body && typeof createResult.body === "object") {
          const responseBody = createResult.body as { id?: string; resource?: { id?: string } };
          shrPatientResourceId = responseBody.id || responseBody.resource?.id || null;
        }

        // If not in body, search again to get the newly created Patient ID
        // (SHR may have assigned a different ID)
        if (!shrPatientResourceId) {
          // Wait a moment for SHR to index the new Patient
          await new Promise((resolve) => setTimeout(resolve, 500));
          
          // Search again to get the newly created Patient ID
          // Re-construct the query with URL encoding
          const encodedPatientId = encodeURIComponent(patientId);
          const searchQuery = `${this.shrChannelPath}/Patient?identifier=urn:impilo:uid%7C${encodedPatientId}`;
          const searchResult = await this.shrClient.get(searchQuery);
          if (searchResult.status === 200) {
            const bundle = searchResult.body as { entry?: Array<{ resource: { id: string } }> };
            if (bundle.entry && bundle.entry.length > 0) {
              shrPatientResourceId = bundle.entry[0]!.resource.id;
            }
          }
        }

        if (shrPatientResourceId) {
          logger.info(
            { 
              patientId, 
              opencrPatientId,
              shrPatientResourceId,
              status: createResult.status
            },
            "Patient created in SHR (from OpenCR)"
          );
          return shrPatientResourceId;
        } else {
          logger.warn(
            { patientId, opencrPatientId, status: createResult.status, body: createResult.body },
            "Patient created in SHR but could not determine resource ID - will retry on next poll"
          );
          // Return null so observation gets queued, will retry when patient appears
          return null;
        }
      } else {
        logger.error(
          { 
            patientId, 
            opencrPatientId, 
            status: createResult.status,
            body: createResult.body
          },
          "Failed to create Patient in SHR"
        );
        return null;
      }
    } catch (err) {
      logger.error(
        { err, patientId },
        "Error checking/creating patient"
      );
      // On error, assume patient doesn't exist to be safe
      return null;
    }
  }

  /**
   * Verify multiple patients in parallel
   * Returns a map of MySQL patient_id -> OpenCR Patient resource ID
   */
  async verifyPatients(patientIds: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    
    // Check in parallel (but limit concurrency)
    const batchSize = 10;
    for (let i = 0; i < patientIds.length; i += batchSize) {
      const batch = patientIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (patientId) => {
          const resourceId = await this.verifyPatientExists(patientId);
          return { patientId, resourceId };
        })
      );
      
      batchResults.forEach(({ patientId, resourceId }) => {
        results.set(patientId, resourceId);
      });
    }
    
    return results;
  }
}



