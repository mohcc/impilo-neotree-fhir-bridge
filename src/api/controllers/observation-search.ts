import { Request, Response } from "express";
import { ShrSearchClient } from "../../opencr/shr-search-client.js";
import type { AppConfig } from "../../config/index.js";

export class ObservationSearchController {
  private readonly searchClient: ShrSearchClient;

  constructor(config: AppConfig) {
    this.searchClient = new ShrSearchClient(config);
  }

  /**
   * Search observations by patient identifier
   * GET /api/observations/patient?patientId=XXX
   * GET /api/observations/patient?identifier=XXX
   * GET /api/observations/patient?identifier=09-0A-17-2026-N-00001
   * 
   * Query Parameters:
   * - patientId: Patient UUID
   * - identifier: Any identifier (NEOTREE-IMPILO-ID, UUID, or full identifier string)
   * - category: Filter by observation category (optional)
   * - code: Filter by observation code (optional)
   * - _lastUpdated: Filter by last updated date (optional)
   */
  async searchByPatient(req: Request, res: Response): Promise<void> {
    try {
      const { patientId, identifier, category, code, _lastUpdated } = req.query;

      // Determine which identifier to use
      const searchIdentifier = identifier as string || patientId as string;

      if (!searchIdentifier) {
        res.status(400).json({
          error: "Missing required parameter",
          message: "Please provide either 'patientId' or 'identifier' query parameter",
          example: "/api/observations/patient?identifier=09-0A-17-2026-N-00001"
        });
        return;
      }

      // Build filters
      const filters: {
        category?: string;
        code?: string;
        _lastUpdated?: string;
      } = {};
      
      if (category) filters.category = category as string;
      if (code) filters.code = code as string;
      if (_lastUpdated) filters._lastUpdated = _lastUpdated as string;

      // Search observations
      const observations = Object.keys(filters).length > 0
        ? await this.searchClient.searchObservations(searchIdentifier, filters)
        : await this.searchClient.searchObservationsByIdentifier(searchIdentifier);

      // Return results
      res.status(200).json({
        identifier: searchIdentifier,
        total: observations.length,
        observations: observations.map(obs => this.transformObservation(obs))
      });
    } catch (err) {
      console.error("[Observation Search] Error:", err);
      res.status(500).json({
        error: "Internal server error",
        message: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  /**
   * Get a specific observation by ID
   * GET /api/observations/:id
   */
  async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          error: "Missing observation ID",
          message: "Please provide an observation ID in the URL path"
        });
        return;
      }

      const observation = await this.searchClient.getObservation(id);

      if (!observation) {
        res.status(404).json({
          error: "Not found",
          message: `Observation with ID '${id}' not found`
        });
        return;
      }

      res.status(200).json(observation);
    } catch (err) {
      console.error("[Observation Search] Error:", err);
      res.status(500).json({
        error: "Internal server error",
        message: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  /**
   * Transform FHIR Observation to simplified format for API response
   */
  private transformObservation(obs: any): Record<string, unknown> {
    const transformed: Record<string, unknown> = {
      id: obs.id,
      status: obs.status,
      effectiveDateTime: obs.effectiveDateTime,
      issued: obs.issued,
    };

    // Extract code
    if (obs.code?.coding?.[0]) {
      transformed.code = obs.code.coding[0].code;
      transformed.display = obs.code.coding[0].display;
    }

    // Extract category
    if (obs.category?.[0]?.coding) {
      const categories = obs.category[0].coding.map((cat: any) => ({
        system: cat.system,
        code: cat.code,
        display: cat.display
      }));
      transformed.category = categories;
    }

    // Extract value
    if (obs.valueInteger !== undefined) {
      transformed.value = obs.valueInteger;
      transformed.valueType = "integer";
    } else if (obs.valueString !== undefined) {
      transformed.value = obs.valueString;
      transformed.valueType = "string";
    } else if (obs.valueBoolean !== undefined) {
      transformed.value = obs.valueBoolean;
      transformed.valueType = "boolean";
    } else if (obs.valueDateTime) {
      transformed.value = obs.valueDateTime;
      transformed.valueType = "dateTime";
    } else if (obs.valueDate) {
      transformed.value = obs.valueDate;
      transformed.valueType = "date";
    } else if (obs.component && obs.component.length > 0) {
      transformed.value = "component";
      transformed.valueType = "component";
      transformed.components = obs.component;
    }

    // Extract subject reference
    if (obs.subject?.reference) {
      transformed.subject = obs.subject.reference;
    }

    // Include extensions if present
    if (obs.extension && obs.extension.length > 0) {
      transformed.extensions = obs.extension;
    }

    return transformed;
  }
}

