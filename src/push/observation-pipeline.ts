import { Pool } from "mysql2/promise";
import { AppConfig } from "../config/index.js";
import { ensureWatermarkTable, fetchNeonatalQuestions, getWatermark, setWatermark } from "../db/mysql.js";
import { ObservationMapper } from "../mapping/observation.js";
import { ObservationResource } from "../mapping/types.js";
import { OpenHimClient } from "../openhim/client.js";
import { logger } from "../observability/logger.js";
import { writeDlq } from "./dlq.js";
import { ObservationValidator } from "../validation/observation-validator.js";
import { PatientVerificationService } from "./patient-verification.js";
import { ObservationQueue } from "./observation-queue.js";
import type { NeonatalQuestionRow } from "../db/mysql.js";

export async function startNeonatalQuestionPipeline(pool: Pool, config: AppConfig): Promise<void> {
  await ensureWatermarkTable(pool, config.ops.watermarkTable);
  
  const clientId = config.facilityId || config.sourceId || "test";
  const client = new OpenHimClient(config);
  const mapper = new ObservationMapper(clientId);
  const validator = new ObservationValidator();
  const patientVerifier = new PatientVerificationService(config);
  const queue = new ObservationQueue(pool);
  
  await queue.ensureQueueTable();
  
  const watermarkKey = "consultation.neonatal_question";
  const shrPath = config.openhim.shrChannelPath;
  
  /**
   * Group observations by patient_id
   */
  const groupByPatient = (rows: NeonatalQuestionRow[]): Map<string, NeonatalQuestionRow[]> => {
    const grouped = new Map<string, NeonatalQuestionRow[]>();
    for (const row of rows) {
      const existing = grouped.get(row.patient_id) || [];
      existing.push(row);
      grouped.set(row.patient_id, existing);
    }
    return grouped;
  };
  
  /**
   * Push observations with retry logic
   * Uses PUT with explicit resource IDs for idempotency (like the bundle example)
   */
  const pushObservationsWithRetry = async (
    path: string,
    observations: ObservationResource[],
    patientId: string,
    maxRetries = 3
  ): Promise<{ success: number; failed: number }> => {
    let successCount = 0;
    let failedCount = 0;
    
    // Push each observation individually using PUT for idempotency
    for (const observation of observations) {
      if (!observation.id) {
        logger.error({ observation, patientId }, "Observation missing ID, cannot use PUT");
        failedCount++;
        await writeDlq(
          { path, resource: observation, patientId },
          new Error("Observation missing ID")
        );
        continue;
      }
      
      let lastError: Error | null = null;
      let pushed = false;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Use PUT with explicit resource ID (idempotent, like bundle example)
          const result = await client.putResource(`${path}/Observation`, observation.id, observation);
          
          if (result.status >= 200 && result.status < 300) {
            logger.info(
              { 
                observationId: observation.id, 
                patientId, 
                dataKey: observation.code?.coding?.[0]?.code,
                status: result.status 
              },
              "Observation pushed successfully (PUT)"
            );
            successCount++;
            pushed = true;
            break;
          } else if (result.status >= 500 && attempt < maxRetries) {
            // Retry on 5xx errors
            const delayMs = 1000 * attempt;
            logger.warn(
              { attempt, maxRetries, status: result.status, delayMs, observationId: observation.id },
              "Retryable error, retrying after delay"
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          } else {
            // Non-retryable error
            lastError = new Error(`HTTP ${result.status}`);
            break;
          }
        } catch (err) {
          lastError = err as Error;
          if (attempt < maxRetries) {
            const delayMs = 1000 * attempt;
            logger.warn(
              { attempt, maxRetries, error: lastError.message, delayMs, observationId: observation.id },
              "Transmission error, retrying after delay"
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
      
      if (!pushed) {
        failedCount++;
        logger.error(
          { err: lastError, observationId: observation.id, patientId },
          "Failed to push observation after retries"
        );
        await writeDlq(
          { path, resource: observation, patientId },
          lastError || new Error("Max retries exceeded")
        );
      }
    }
    
    return { success: successCount, failed: failedCount };
  };
  
  /**
   * Process queued observations for a patient
   */
  const processQueuedObservations = async (patientId: string): Promise<void> => {
    const queued = await queue.getQueuedObservations(patientId);
    if (queued.length === 0) return;
    
    // Get Patient resource ID from OpenCR
    const patientResourceId = await patientVerifier.verifyPatientExists(patientId);
    if (!patientResourceId) {
      logger.warn({ patientId }, "Patient still not found, skipping queued observations");
      return;
    }
    
    logger.info({ patientId, patientResourceId, count: queued.length }, "Processing queued observations");
    
    // Map to FHIR Observations (using OpenCR Patient resource ID)
    const fhirObservations: ObservationResource[] = [];
    for (const row of queued) {
      try {
        const observation = mapper.map(row, patientResourceId);
        const sanitized = validator.sanitize(observation);
        const validation = validator.validate(sanitized);
        
        if (validation.valid) {
          fhirObservations.push(sanitized);
        } else {
          logger.warn(
            { observationId: row.id, errors: validation.errors },
            "Queued observation failed validation"
          );
          await queue.markFailed(row.id);
        }
      } catch (err) {
        logger.error({ err, observationId: row.id }, "Error mapping queued observation");
        await queue.markFailed(row.id);
      }
    }
    
    if (fhirObservations.length > 0) {
      const result = await pushObservationsWithRetry(shrPath, fhirObservations, patientId);
      
      // Remove successfully pushed observations from queue
      for (const obs of fhirObservations) {
        if (obs.id) {
          const questionId = obs.id.replace("neonatal-question-", "");
          await queue.dequeue(questionId);
        }
      }
      
      logger.info(
        { patientId, success: result.success, failed: result.failed },
        "Processed queued observations"
      );
    }
  };
  
  const pollAndProcess = async (): Promise<void> => {
    try {
      // Mark expired observations (older than 24 hours)
      const expiredCount = await queue.markExpired();
      if (expiredCount > 0) {
        logger.warn({ count: expiredCount }, "Marked expired observations");
      }
      
      // Get watermark
      const current = await getWatermark(pool, config.ops.watermarkTable, watermarkKey);
      logger.debug({ watermark: current, table: watermarkKey }, "Polling for new observations");
      
      // Fetch new observations
      const rows = await fetchNeonatalQuestions(
        pool,
        current,
        config.ops.pushBatchSize
      );
      
      if (rows.length === 0) {
        logger.debug({ watermark: current, table: watermarkKey }, "No new observations found");
        return;
      }
      
      logger.info(
        { count: rows.length, watermark: current, table: watermarkKey },
        "Found new observations to process"
      );
      
      // Group by patient_id
      const byPatient = groupByPatient(rows);
      
      // Process each patient's observations
      for (const [patientId, observations] of byPatient.entries()) {
        // Verify patient exists in OpenCR and get the Patient resource ID
        const patientResourceId = await patientVerifier.verifyPatientExists(patientId);
        
        if (!patientResourceId) {
          logger.warn(
            { patientId, observationCount: observations.length },
            "Patient not found in OpenCR, queuing observations"
          );
          await queue.enqueue(patientId, observations);
          continue;
        }
        
        logger.debug(
          { patientId, patientResourceId },
          "Patient found in OpenCR, using resource ID for Observation references"
        );
        
        // Process any queued observations for this patient first
        // Wrap in try-catch so errors don't block new observations
        try {
          await processQueuedObservations(patientId);
        } catch (err) {
          logger.error(
            { err, patientId },
            "Error processing queued observations, continuing with new observations"
          );
        }
        
        // Map to FHIR Observations (using OpenCR Patient resource ID)
        const fhirObservations: ObservationResource[] = [];
        const invalidObservations: NeonatalQuestionRow[] = [];
        
        for (const row of observations) {
          try {
            const observation = mapper.map(row, patientResourceId);
            const sanitized = validator.sanitize(observation);
            const validation = validator.validate(sanitized);
            
            if (validation.valid) {
              fhirObservations.push(sanitized);
            } else {
              logger.warn(
                { observationId: row.id, errors: validation.errors },
                "Observation validation failed"
              );
              invalidObservations.push(row);
            }
          } catch (err) {
            logger.error({ err, observationId: row.id }, "Error mapping observation");
            invalidObservations.push(row);
          }
        }
        
        // Write invalid observations to DLQ
        for (const row of invalidObservations) {
          await writeDlq(
            { path: shrPath, resource: { id: row.id, patientId }, table: watermarkKey },
            new Error("Validation or mapping failed")
          );
        }
        
        // Push valid observations
        if (fhirObservations.length > 0) {
          const result = await pushObservationsWithRetry(shrPath, fhirObservations, patientId);
          
          logger.info(
            {
              patientId,
              total: observations.length,
              valid: fhirObservations.length,
              invalid: invalidObservations.length,
              success: result.success,
              failed: result.failed
            },
            "Processed observations for patient"
          );
        }
      }
      
      // Update watermark only after successful processing
      // Use date (LocalDateTime) instead of ID for accurate chronological tracking
      // The date is already converted to UTC format "YYYY-MM-DD HH:MM:SS" by the query
      const lastRow = rows[rows.length - 1];
      if (lastRow && lastRow.date) {
        const lastUpdated = String(lastRow.date);
        await setWatermark(pool, config.ops.watermarkTable, watermarkKey, lastUpdated);
        logger.debug({ watermark: lastUpdated, table: watermarkKey }, "Updated watermark with date");
      } else if (lastRow) {
        // Fallback to ID if date is not available (shouldn't happen if date column exists)
        logger.warn({ observationId: lastRow.id }, "date column not available, falling back to ID for watermark");
        await setWatermark(pool, config.ops.watermarkTable, watermarkKey, lastRow.id);
        logger.debug({ watermark: lastRow.id, table: watermarkKey }, "Updated watermark (using ID fallback)");
      }
    } catch (err) {
      logger.error({ err }, "Error in pollAndProcess for observations");
      // Continue polling despite errors
    }
  };
  
  // Start polling
  const pollTimer = setInterval(() => { void pollAndProcess(); }, config.ops.pollIntervalMs);
  void pollAndProcess(); // Initial poll
  
  logger.info({ watermarkKey, shrPath }, "Neonatal question pipeline started");
}

