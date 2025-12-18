import { ObservationResource } from "../mapping/types.js";
import { logger } from "../observability/logger.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates FHIR Observation resources before sending to OpenCR
 */
export class ObservationValidator {
  /**
   * Validates an Observation resource according to FHIR R4 spec
   */
  validate(observation: ObservationResource): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required: resourceType
    if (observation.resourceType !== "Observation") {
      errors.push("Resource type must be 'Observation'");
    }

    // Required: status
    if (!observation.status) {
      errors.push("Observation status is required");
    }

    // Required: code
    if (!observation.code || !observation.code.coding || observation.code.coding.length === 0) {
      errors.push("Observation code is required");
    } else {
      observation.code.coding.forEach((coding, index) => {
        if (!coding.code) {
          errors.push(`Code coding ${index + 1}: code is required`);
        }
      });
    }

    // Required: subject
    if (!observation.subject || !observation.subject.reference) {
      errors.push("Observation subject reference is required");
    } else {
      if (!observation.subject.reference.startsWith("Patient/")) {
        errors.push("Subject reference must be in format 'Patient/{id}'");
      }
    }

    // At least one value required
    const hasValue = 
      observation.valueInteger !== undefined ||
      observation.valueString !== undefined ||
      observation.valueBoolean !== undefined ||
      observation.valueDateTime !== undefined ||
      observation.valueDate !== undefined ||
      (observation.component && observation.component.length > 0);
    
    if (!hasValue) {
      errors.push("Observation must have at least one value (valueInteger, valueString, valueBoolean, valueDateTime, valueDate, or component)");
    }

    // Validate effectiveDateTime format if present
    if (observation.effectiveDateTime) {
      const date = new Date(observation.effectiveDateTime);
      if (Number.isNaN(date.getTime())) {
        errors.push(`Invalid effectiveDateTime format: ${observation.effectiveDateTime}`);
      }
    }

    // Warnings
    if (!observation.effectiveDateTime) {
      warnings.push("Observation should have effectiveDateTime");
    }

    if (!observation.category || observation.category.length === 0) {
      warnings.push("Observation should have a category");
    }

    const valid = errors.length === 0;

    if (!valid) {
      logger.warn(
        { errors, warnings, observationId: observation.id },
        "Observation validation failed"
      );
    } else if (warnings.length > 0) {
      logger.info(
        { warnings, observationId: observation.id },
        "Observation validation passed with warnings"
      );
    }

    return { valid, errors, warnings };
  }

  /**
   * Sanitizes observation data
   */
  sanitize(observation: ObservationResource): ObservationResource {
    const sanitized = { ...observation };

    // Sanitize code
    if (sanitized.code?.coding) {
      sanitized.code.coding = sanitized.code.coding.map(coding => ({
        ...coding,
        system: coding.system ? String(coding.system).trim() : coding.system,
        code: coding.code ? String(coding.code).trim() : coding.code,
        display: coding.display ? String(coding.display).trim() : coding.display,
      }));
    }

    // Sanitize valueString
    if (sanitized.valueString) {
      sanitized.valueString = this.sanitizeString(sanitized.valueString);
    }

    // Sanitize component values
    if (sanitized.component) {
      sanitized.component = sanitized.component.map(comp => ({
        ...comp,
        valueString: comp.valueString ? this.sanitizeString(comp.valueString) : comp.valueString,
      }));
    }

    return sanitized;
  }

  /**
   * Sanitizes a string (removes control characters, trims)
   */
  private sanitizeString(str: string): string {
    return String(str)
      .trim()
      .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
      .replace(/\s+/g, " "); // Normalize whitespace
  }
}





