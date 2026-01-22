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

      // Select the best patient when duplicates exist
      // Priority: 1) Has PHID (most authoritative), 2) Most identifiers
      let opencrPatient = opencrPatients[0]!;
      
      if (opencrPatients.length > 1) {
        logger.warn(
          { patientId, count: opencrPatients.length },
          "Multiple patients found with same identifier - selecting best match"
        );
        
        // Prefer patient with PHID (primary identifier)
        const patientWithPhid = opencrPatients.find(p => p.identifiers.phid);
        if (patientWithPhid) {
          opencrPatient = patientWithPhid;
          logger.debug(
            { selectedId: opencrPatient.id, phid: opencrPatient.identifiers.phid },
            "Selected patient with PHID"
          );
        } else {
          // Fall back to patient with most identifiers
          opencrPatient = opencrPatients.reduce((best, current) => {
            const bestCount = Object.values(best.identifiers).filter(Boolean).length;
            const currentCount = Object.values(current.identifiers).filter(Boolean).length;
            return currentCount > bestCount ? current : best;
          });
          logger.debug(
            { selectedId: opencrPatient.id },
            "Selected patient with most identifiers"
          );
        }
      }
      
      const opencrPatientId = opencrPatient.id;
      
      // Get the best identifier for SHR lookup (priority: phid > neotreeId > personId)
      const shrLookupIdentifier = opencrPatient.identifiers.phid 
        ? { system: "urn:impilo:phid", value: opencrPatient.identifiers.phid }
        : opencrPatient.identifiers.neotreeId
        ? { system: "urn:neotree:impilo-id", value: opencrPatient.identifiers.neotreeId }
        : opencrPatient.identifiers.personId
        ? { system: "urn:impilo:person-id", value: opencrPatient.identifiers.personId }
        : null;

      if (!shrLookupIdentifier) {
        logger.warn(
          { patientId, opencrPatientId },
          "Patient found in OpenCR but has no usable identifier for SHR lookup"
        );
        return null;
      }

      logger.debug(
        { patientId, foundIn: "OpenCR", opencrPatientId, shrLookupIdentifier },
        "Patient verified in OpenCR"
      );

      // Step 2: Check if Patient exists in SHR
      // Use identifier from OpenCR Patient (phid, neotree-id, or person-id)
      const encodedIdentifier = encodeURIComponent(`${shrLookupIdentifier.system}|${shrLookupIdentifier.value}`);
      const patientIdQuery = `${this.shrChannelPath}/Patient?identifier=${encodedIdentifier}`;

      // Search SHR with identifier
      const result = await this.shrClient.get(patientIdQuery);
      if (result.status === 200) {
        const bundle = result.body as { entry?: Array<{ resource: { id: string } }> };
        if (bundle.entry && bundle.entry.length > 0) {
          // Normalize: strip "Patient/" prefix if present
          let shrPatientResourceId = bundle.entry[0]!.resource.id;
          if (shrPatientResourceId.startsWith("Patient/")) {
            shrPatientResourceId = shrPatientResourceId.replace("Patient/", "");
          }
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

      const opencrPatientFull = opencrPatientResult.body as FhirPatient;
      
      // Prepare shallow Patient for SHR
      // SHR only needs: identifier + gender + birthDate + managingOrganization for linking Observations
      // Full demographics (name, address) stay in OpenCR (master patient index)
      const shrPatient: FhirPatient = {
        resourceType: "Patient",
        // Keep identifiers (needed for linking and lookup)
        identifier: opencrPatientFull.identifier,
        // Keep gender
        gender: opencrPatientFull.gender,
        // Keep birthDate (DOB)
        birthDate: opencrPatientFull.birthDate,
        // Keep managingOrganization (facility reference)
        managingOrganization: opencrPatientFull.managingOrganization,
        // NO other demographics: name, address stay in OpenCR only
      };

      logger.debug(
        {
          patientId,
          opencrPatientId,
          identifierCount: shrPatient.identifier?.length || 0,
          gender: shrPatient.gender,
          birthDate: shrPatient.birthDate,
          managingOrganization: shrPatient.managingOrganization?.reference,
          excludedFields: {
            name: !!opencrPatientFull.name,
            address: !!opencrPatientFull.address
          }
        },
        "Prepared shallow Patient for SHR (identifier + gender + DOB + organization)"
      );

      // POST Patient to SHR
      const createResult = await this.shrClient.postResource(`${this.shrChannelPath}/Patient`, shrPatient);
      
      if (createResult.status >= 200 && createResult.status < 300) {
        // Extract Patient resource ID from response
        let shrPatientResourceId: string | null = null;
        
        // Try to get ID from response body (FHIR Patient resource)
        if (createResult.body && typeof createResult.body === "object") {
          const responseBody = createResult.body as { id?: string; resource?: { id?: string } };
          let rawId = responseBody.id || responseBody.resource?.id || null;
          // Normalize: strip "Patient/" prefix if present (OpenCR returns "Patient/uuid" format)
          if (rawId && rawId.startsWith("Patient/")) {
            rawId = rawId.replace("Patient/", "");
          }
          shrPatientResourceId = rawId;
        }

        // If not in body, search again to get the newly created Patient ID
        // (SHR may have assigned a different ID)
        if (!shrPatientResourceId) {
          // Wait a moment for SHR to index the new Patient
          await new Promise((resolve) => setTimeout(resolve, 500));
          
          // Search again to get the newly created Patient ID
          // Use the same identifier we used for initial lookup
          const searchQuery = `${this.shrChannelPath}/Patient?identifier=${encodedIdentifier}`;
          const searchResult = await this.shrClient.get(searchQuery);
          if (searchResult.status === 200) {
            const bundle = searchResult.body as { entry?: Array<{ resource: { id: string } }> };
            if (bundle.entry && bundle.entry.length > 0) {
              let foundId = bundle.entry[0]!.resource.id;
              // Normalize: strip "Patient/" prefix if present
              if (foundId.startsWith("Patient/")) {
                foundId = foundId.replace("Patient/", "");
              }
              shrPatientResourceId = foundId;
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



