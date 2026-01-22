import { PatientResource } from "../mapping/types.js";
import { logger } from "../observability/logger.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates FHIR Patient resources before sending to OpenCR
 */
export class PatientValidator {
  /**
   * Validates a Patient resource according to FHIR R4 spec and Neotree requirements
   */
  validate(patient: PatientResource): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required: resourceType
    if (patient.resourceType !== "Patient") {
      errors.push("Resource type must be 'Patient'");
    }

    // Required: At least one identifier
    if (!patient.identifier || patient.identifier.length === 0) {
      errors.push("Patient must have at least one identifier");
    } else {
      // Validate identifier format
      patient.identifier.forEach((ident, index) => {
        if (!ident.system) {
          errors.push(`Identifier ${index + 1}: system is required`);
        }
        if (!ident.value || String(ident.value).trim().length === 0) {
          errors.push(`Identifier ${index + 1}: value is required`);
        }
      });
    }

    // Validate name (at least one name recommended)
    if (!patient.name || patient.name.length === 0) {
      warnings.push("Patient should have at least one name");
    } else {
      patient.name.forEach((name, index) => {
        if (!name.family && (!name.given || name.given.length === 0)) {
          warnings.push(
            `Name ${index + 1}: should have at least family or given name`
          );
        }
      });
    }

    // Validate birthDate format (YYYY-MM-DD)
    if (patient.birthDate) {
      if (!this.isValidDate(patient.birthDate)) {
        errors.push(
          `Invalid birthDate format: ${patient.birthDate}. Expected YYYY-MM-DD`
        );
      } else {
        // Check if date is reasonable (not in future, not too old)
        const birthDate = new Date(patient.birthDate);
        const now = new Date();
        if (birthDate > now) {
          errors.push("Birth date cannot be in the future");
        }
        const maxAge = 120; // years
        const minDate = new Date();
        minDate.setFullYear(minDate.getFullYear() - maxAge);
        if (birthDate < minDate) {
          warnings.push(`Birth date is more than ${maxAge} years ago`);
        }
      }
    }

    // Validate gender
    if (patient.gender) {
      const validGenders = ["male", "female", "other", "unknown"];
      if (!validGenders.includes(patient.gender)) {
        errors.push(
          `Invalid gender: ${patient.gender}. Must be one of: ${validGenders.join(", ")}`
        );
      }
    }

    // Validate managingOrganization reference format
    if (patient.managingOrganization?.reference) {
      const orgRef = patient.managingOrganization.reference;
      if (!orgRef.startsWith("Organization/")) {
        errors.push(
          `Invalid managingOrganization reference format: ${orgRef}. Expected 'Organization/{id}'`
        );
      }
    }

    // Validate NEOTREE-IMPILO-ID format if present
    const neotreeId = patient.identifier?.find(
      (id) => id.system === "urn:neotree:impilo-id"
    );
    if (neotreeId?.value) {
      const neotreeValue = String(neotreeId.value).trim();
      if (!this.isValidNeotreeId(neotreeValue)) {
        errors.push(
          `Invalid NEOTREE-IMPILO-ID format: ${neotreeValue}. Expected format: PP-DD-SS-YYYY-P-XXXXX (e.g., 00-0A-34-2025-N-01031)`
        );
      }
    }

    const valid = errors.length === 0;

    if (!valid) {
      logger.warn(
        { errors, warnings, patientId: patient.identifier?.[0]?.value },
        "Patient validation failed"
      );
    } else if (warnings.length > 0) {
      logger.info(
        { warnings, patientId: patient.identifier?.[0]?.value },
        "Patient validation passed with warnings"
      );
    }

    return { valid, errors, warnings };
  }

  /**
   * Validates date format (YYYY-MM-DD)
   */
  private isValidDate(dateStr: string): boolean {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      return false;
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    // Check if date components match (handles invalid dates like 2023-13-45)
    const parts = dateStr.split("-");
    const year = Number.parseInt(parts[0] || "0", 10);
    const month = Number.parseInt(parts[1] || "0", 10);
    const day = Number.parseInt(parts[2] || "0", 10);

    return (
      date.getFullYear() === year &&
      date.getMonth() + 1 === month &&
      date.getDate() === day
    );
  }

  /**
   * Sanitizes patient data (removes invalid characters, trims strings)
   */
  sanitize(patient: PatientResource): PatientResource {
    const sanitized = { ...patient };

    // Sanitize identifiers
    if (sanitized.identifier) {
      sanitized.identifier = sanitized.identifier.map((ident) => ({
        ...ident,
        system: ident.system ? String(ident.system).trim() : ident.system,
        value: ident.value ? String(ident.value).trim() : ident.value,
      }));
    }

    // Sanitize names
    if (sanitized.name) {
      sanitized.name = sanitized.name.map((name) => ({
        ...name,
        family: name.family ? this.sanitizeString(name.family) : name.family,
        given: name.given
          ? name.given.map((g) => this.sanitizeString(g))
          : name.given,
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

  /**
   * Validates NEOTREE-IMPILO-ID format: PP-DD-SS-YYYY-P-XXXXX
   * Example: 00-0A-34-2025-N-01031
   * - PP: 2 hex characters
   * - DD: 2 hex characters
   * - SS: 2 hex characters
   * - YYYY: 4 digits (year)
   * - P: 1 letter (A-Z)
   * - XXXXX: 5 digits (sequential number)
   */
  private isValidNeotreeId(id: string): boolean {
    const neotreeIdRegex = /^[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}-\d{4}-[A-Za-z]-\d{5}$/;
    
    if (!neotreeIdRegex.test(id)) {
      return false;
    }

    const parts = id.split("-");
    if (parts.length !== 6) {
      return false;
    }

    // Validate each part - use array indexing for better type narrowing
    const pp = parts[0];
    const dd = parts[1];
    const ss = parts[2];
    const year = parts[3];
    const p = parts[4];
    const sequential = parts[5];

    // Ensure all parts are defined
    if (!pp || !dd || !ss || !year || !p || !sequential) {
      return false;
    }

    // PP, DD, SS: 2 hex characters
    if (!/^[0-9A-Fa-f]{2}$/.test(pp) || !/^[0-9A-Fa-f]{2}$/.test(dd) || !/^[0-9A-Fa-f]{2}$/.test(ss)) {
      return false;
    }

    // YYYY: 4 digits, reasonable year (1900-2100)
    const yearNum = Number.parseInt(year, 10);
    if (Number.isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
      return false;
    }

    // P: 1 letter
    if (!/^[A-Za-z]$/.test(p)) {
      return false;
    }

    // XXXXX: 5 digits
    if (!/^\d{5}$/.test(sequential)) {
      return false;
    }

    return true;
  }
}

