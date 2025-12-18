import { Pool } from "mysql2/promise";
import { AppConfig } from "../config/index.js";
import { ensureWatermarkTable, fetchNeonatalCareWithDemographics, getWatermark, setWatermark } from "../db/mysql.js";
import { PatientMapper } from "../mapping/patient.js";
import { PatientResource, NeonatalCareRow } from "../mapping/types.js";
import { OpenHimClient } from "../openhim/client.js";
import { logger } from "../observability/logger.js";
import { writeDlq } from "./dlq.js";
import { PatientValidator } from "../validation/patient-validator.js";
import { AuditLogger, RegistrationResult } from "../audit/audit-logger.js";

export async function startOpencrPushPipeline(pool: Pool, config: AppConfig): Promise<void> {
  await ensureWatermarkTable(pool, config.ops.watermarkTable);
  // Use FACILITY_ID from config if set, otherwise fall back to SOURCE_ID
  // OpenCR requires a registered client ID - check OpenCR client registry for valid IDs
  const clientId = config.facilityId || config.sourceId || "test";
  const mapper = new PatientMapper(clientId);
  const client = new OpenHimClient(config);
  const validator = new PatientValidator();
  const auditLogger = new AuditLogger(config.sourceId);

  // Poll neonatal_care with demographics join
  const watermarkKey = "consultation.neonatal_care";
  let pollTimer: NodeJS.Timeout | null = null;

  /**
   * Pushes a single Patient resource with retry logic
   */
  const pushPatientWithRetry = async (
    path: string,
    patient: PatientResource,
    maxRetries = 3
  ) => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // POST /Patient
        const result = await client.postResource(`${path}/Patient`, patient);
        return result;
      } catch (err) {
        lastError = err as Error;
        auditLogger.logTransmissionError(patient, lastError, attempt, maxRetries);
        if (attempt < maxRetries) {
          const delayMs = 1000 * attempt;
          logger.warn({ attempt, maxRetries, error: lastError.message, delayMs }, "Retryable error, retrying after delay");
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError || new Error("Max retries exceeded");
  };

  /**
   * Processes OpenCR response and extracts match information
   */
  const processResponse = (
    response: { status: number; body: unknown },
    entries: Array<{ request: unknown; resource: PatientResource }>
  ): void => {
    if (!response.body || typeof response.body !== "object") {
      return;
    }

    const bundle = response.body as {
      resourceType?: string;
      type?: string;
      entry?: Array<{
        response?: {
          status?: string;
          location?: string;
        };
      }>;
    };

    if (bundle.resourceType !== "Bundle" || bundle.type !== "transaction-response") {
      return;
    }

    bundle.entry?.forEach((entry, index) => {
      const patient = entries[index]?.resource;
      if (!patient) return;

      const responseStatus = entry.response?.status || "";
      const location = entry.response?.location || "";

      // Extract OpenCR ID from location (e.g., "Patient/123/_history/1")
      const opencrIdMatch = location.match(/Patient\/([^/]+)/);
      const opencrId = opencrIdMatch ? opencrIdMatch[1] : undefined;

      // Determine registration result
      let result: RegistrationResult;
      if (responseStatus.includes("200") || responseStatus.includes("201")) {
        // Success - check if it's a duplicate (409) or new (200/201)
        if (responseStatus.includes("409")) {
          result = {
            status: "duplicate",
            patientId: patient.identifier?.[0]?.value,
            opencrId,
            timestamp: new Date().toISOString(),
          };
        } else {
          result = {
            status: "success",
            patientId: patient.identifier?.[0]?.value,
            opencrId,
            timestamp: new Date().toISOString(),
          };
        }
      } else if (responseStatus.includes("400") || responseStatus.includes("422")) {
        result = {
          status: "validation_failed",
          patientId: patient.identifier?.[0]?.value,
          error: `Validation failed: ${responseStatus}`,
          timestamp: new Date().toISOString(),
        };
      } else {
        result = {
          status: "error",
          patientId: patient.identifier?.[0]?.value,
          error: `Unexpected status: ${responseStatus}`,
          timestamp: new Date().toISOString(),
        };
      }

      // Log audit event
      auditLogger.logPatientRegistration(patient, result);
    });
  };

  const pollAndProcess = async (): Promise<void> => {
    try {
      const current = await getWatermark(pool, config.ops.watermarkTable, watermarkKey);
      logger.debug({ watermark: current, table: watermarkKey }, "Polling for new records");
      
      const rows = await fetchNeonatalCareWithDemographics(
        pool,
        current,
        config.ops.pushBatchSize
      );

      if (rows.length === 0) {
        logger.debug({ watermark: current, table: watermarkKey }, "No new records found");
        return;
      }
      
      logger.info({ count: rows.length, watermark: current, table: watermarkKey }, "Found new records to process");

      // Map rows to FHIR Patient resources
      const mappedPatients: PatientResource[] = [];
      const validatedEntries: Array<{ request: unknown; resource: PatientResource }> = [];

      for (const row of rows) {
        const patient = mapper.map(row);
        
        // Log if IMPILO-NEOTREE-ID is included
        if (row.impilo_neotree_id) {
          logger.debug({ impilo_neotree_id: row.impilo_neotree_id, patient_id: row.patient_id }, "Processing record with IMPILO-NEOTREE-ID");
        }
        
        // Sanitize patient data
        const sanitized = validator.sanitize(patient);
        
        // Validate patient
        const validation = validator.validate(sanitized);
        
        if (!validation.valid) {
          // Log validation error
          auditLogger.logValidationError(sanitized, validation.errors);
          
          // Write to DLQ for manual review
          await writeDlq(
            { path: config.openhim.channelPath, entries: [{ request: { method: "POST", url: "Patient" }, resource: sanitized }], table: watermarkKey },
            new Error(`Validation failed: ${validation.errors.join(", ")}`)
          );
          continue; // Skip invalid patients
        }

        // Add to validated entries
        mappedPatients.push(sanitized);
        validatedEntries.push({
          request: { method: "POST", url: "Patient" },
          resource: sanitized,
        });
      }

      if (validatedEntries.length === 0) {
        logger.warn({ total: rows.length }, "All patients failed validation, skipping batch");
        return;
      }

      // Push each Patient individually with retry
      const path = config.openhim.channelPath;
      let successCount = 0;
      for (const entry of validatedEntries) {
        try {
          const res = await pushPatientWithRetry(path, entry.resource, 3);
          successCount += (res.status >= 200 && res.status < 300) ? 1 : 0;
          logger.info({ status: res.status }, "pushed patient to OpenHIM");
        } catch (err) {
          logger.error({ err }, "failed to push patient to OpenHIM after retries");
          await writeDlq({ path, entries: [entry], table: watermarkKey }, err);
        }
      }

      // Update watermark with the latest date_time_admission regardless of partial failures
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        const lastUpdated = String(lastRow.date_time_admission);
        await setWatermark(pool, config.ops.watermarkTable, watermarkKey, lastUpdated);
      }
    } catch (err) {
      logger.error({ err }, "error in pollAndProcess");
      // Continue polling despite errors
    }
  };

  // Start polling
  pollTimer = setInterval(() => { void pollAndProcess(); }, config.ops.pollIntervalMs);
  void pollAndProcess(); // Initial poll
}

