import { logger } from "../observability/logger.js";
import { PatientResource } from "../mapping/types.js";

export interface RegistrationResult {
  status: "success" | "duplicate" | "error" | "validation_failed";
  patientId?: string;
  opencrId?: string;
  goldenRecordId?: string;
  matchConfidence?: number;
  matchType?: "autoMatch" | "potentialMatch" | "noMatch";
  error?: string;
  timestamp: string;
}

export interface AuditEvent {
  eventType: "patient_registration" | "patient_update" | "duplicate_detected" | "validation_error" | "transmission_error";
  patientId?: string;
  source: string;
  timestamp: string;
  result: RegistrationResult;
  metadata?: Record<string, unknown>;
}

/**
 * Audit logger for patient registration activities
 */
export class AuditLogger {
  private readonly source: string;

  constructor(source = "neotree-opencr-bridge") {
    this.source = source;
  }

  /**
   * Logs a patient registration event
   */
  logPatientRegistration(
    patient: PatientResource,
    result: RegistrationResult
  ): void {
    const event: AuditEvent = {
      eventType: "patient_registration",
      patientId: patient.identifier?.[0]?.value,
      source: this.source,
      timestamp: new Date().toISOString(),
      result: {
        ...result,
        timestamp: result.timestamp || new Date().toISOString(),
      },
      metadata: {
        resourceType: patient.resourceType,
        identifierCount: patient.identifier?.length || 0,
        hasName: !!patient.name && patient.name.length > 0,
        hasBirthDate: !!patient.birthDate,
        hasGender: !!patient.gender,
      },
    };

    // Log to structured logger (Pino)
    if (result.status === "success") {
      logger.info(
        {
          event: "patient_registration",
          ...event,
        },
        `Patient registration successful: ${event.patientId}`
      );
    } else if (result.status === "duplicate") {
      logger.warn(
        {
          event: "patient_registration",
          ...event,
        },
        `Duplicate patient detected: ${event.patientId}`
      );
    } else {
      logger.error(
        {
          event: "patient_registration",
          ...event,
        },
        `Patient registration failed: ${event.patientId} - ${result.error}`
      );
    }
  }

  /**
   * Logs a duplicate detection event
   */
  logDuplicateDetected(
    patient: PatientResource,
    existingOpencrId: string,
    matchConfidence: number
  ): void {
    const event: AuditEvent = {
      eventType: "duplicate_detected",
      patientId: patient.identifier?.[0]?.value,
      source: this.source,
      timestamp: new Date().toISOString(),
      result: {
        status: "duplicate",
        patientId: patient.identifier?.[0]?.value,
        opencrId: existingOpencrId,
        matchConfidence,
        timestamp: new Date().toISOString(),
      },
    };

    logger.warn(
      {
        event: "duplicate_detected",
        ...event,
      },
      `Duplicate patient detected: ${event.patientId} matches ${existingOpencrId}`
    );
  }

  /**
   * Logs a validation error
   */
  logValidationError(
    patient: PatientResource,
    errors: string[]
  ): void {
    const event: AuditEvent = {
      eventType: "validation_error",
      patientId: patient.identifier?.[0]?.value,
      source: this.source,
      timestamp: new Date().toISOString(),
      result: {
        status: "validation_failed",
        patientId: patient.identifier?.[0]?.value,
        error: errors.join("; "),
        timestamp: new Date().toISOString(),
      },
      metadata: {
        validationErrors: errors,
      },
    };

    logger.error(
      {
        event: "validation_error",
        ...event,
      },
      `Patient validation failed: ${event.patientId} - ${errors.join(", ")}`
    );
  }

  /**
   * Logs a transmission error
   */
  logTransmissionError(
    patient: PatientResource,
    error: Error,
    attempt: number,
    maxRetries: number
  ): void {
    const event: AuditEvent = {
      eventType: "transmission_error",
      patientId: patient.identifier?.[0]?.value,
      source: this.source,
      timestamp: new Date().toISOString(),
      result: {
        status: "error",
        patientId: patient.identifier?.[0]?.value,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      metadata: {
        attempt,
        maxRetries,
        errorType: error.constructor.name,
      },
    };

    logger.error(
      {
        event: "transmission_error",
        ...event,
      },
      `Transmission error (attempt ${attempt}/${maxRetries}): ${event.patientId} - ${error.message}`
    );
  }
}


