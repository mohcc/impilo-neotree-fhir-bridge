import { Request, Response } from "express";
import { OpenCRSearchClient } from "../../opencr/search-client.js";
import { SearchParams, SearchResponse, DuplicateRisk, SearchType, SimplifiedPatient } from "../types.js";
import type { AppConfig } from "../../config/index.js";

export class PatientSearchController {
  private readonly searchClient: OpenCRSearchClient;

  constructor(config: AppConfig) {
    this.searchClient = new OpenCRSearchClient(config);
  }

  /**
   * Search by identifier (NEOTREE-IMPILO-ID or Patient ID)
   * GET /api/patients/search/by-identifier?identifier=XXX
   */
  async searchByIdentifier(req: Request, res: Response): Promise<void> {
    const { identifier } = req.query;

    if (!identifier || typeof identifier !== "string") {
      res.status(400).json({
        error: "Missing or invalid 'identifier' query parameter",
      });
      return;
    }

    try {
      const patients = await this.searchClient.searchByIdentifier(identifier);
      const response = this.buildResponse(
        { identifier },
        patients,
        "identifier"
      );
      res.status(200).json(response);
    } catch (err) {
      this.handleError(res, err);
    }
  }

  /**
   * Search by demographics (name, DOB, gender)
   * GET /api/patients/search/by-demographics?given=X&family=Y&birthDate=Z&gender=W
   */
  async searchByDemographics(req: Request, res: Response): Promise<void> {
    const { given, family, birthDate, gender } = req.query;

    const params: SearchParams = {
      given: given as string | undefined,
      family: family as string | undefined,
      birthDate: birthDate as string | undefined,
      gender: gender as "male" | "female" | "other" | "unknown" | undefined,
    };

    // At least one demographic parameter required
    if (!params.given && !params.family && !params.birthDate && !params.gender) {
      res.status(400).json({
        error: "At least one demographic parameter required (given, family, birthDate, gender)",
      });
      return;
    }

    try {
      const patients = await this.searchClient.searchByDemographics(params);
      const response = this.buildResponse(params, patients, "demographics");
      res.status(200).json(response);
    } catch (err) {
      this.handleError(res, err);
    }
  }

  /**
   * Fuzzy search (handles name variations)
   * GET /api/patients/search/fuzzy?given=X&family=Y&birthDate=Z&threshold=0.85
   */
  async searchFuzzy(req: Request, res: Response): Promise<void> {
    const { given, family, birthDate, threshold } = req.query;

    const params: SearchParams = {
      given: given as string | undefined,
      family: family as string | undefined,
      birthDate: birthDate as string | undefined,
      threshold: threshold ? parseFloat(threshold as string) : 0.85,
    };

    if (!params.given && !params.family) {
      res.status(400).json({
        error: "At least one name parameter required (given or family)",
      });
      return;
    }

    try {
      const patients = await this.searchClient.searchFuzzy(params);
      const response = this.buildResponse(params, patients, "fuzzy");
      res.status(200).json(response);
    } catch (err) {
      this.handleError(res, err);
    }
  }

  /**
   * Flexible search with any combination of parameters
   * GET /api/patients/search?identifier=X&given=Y&family=Z&birthDate=W&gender=V
   */
  async search(req: Request, res: Response): Promise<void> {
    const { identifier, given, family, birthDate, gender } = req.query;

    const params: SearchParams = {
      identifier: identifier as string | undefined,
      given: given as string | undefined,
      family: family as string | undefined,
      birthDate: birthDate as string | undefined,
      gender: gender as "male" | "female" | "other" | "unknown" | undefined,
    };

    // At least one parameter required
    if (!params.identifier && !params.given && !params.family && !params.birthDate && !params.gender) {
      res.status(400).json({
        error: "At least one search parameter required",
      });
      return;
    }

    try {
      const patients = await this.searchClient.search(params);
      const response = this.buildResponse(params, patients, "flexible");
      res.status(200).json(response);
    } catch (err) {
      this.handleError(res, err);
    }
  }

  /**
   * Build standardized search response with duplicate risk assessment
   */
  private buildResponse(
    query: SearchParams,
    patients: SimplifiedPatient[],
    searchType: SearchType
  ): SearchResponse {
    const count = patients.length;
    const found = count > 0;
    
    // Calculate confidence based on search type and result count
    const confidence = this.calculateConfidence(searchType, count);
    
    // Calculate duplicate risk
    const duplicateRisk = this.calculateDuplicateRisk(searchType, count);

    // Generate helpful message
    let message: string | undefined;
    if (!found) {
      message = "No matching patients found. Safe to create new record.";
    } else if (searchType === "identifier" && count > 0) {
      // Exact identifier match - patient already exists
      if (count === 1 && patients[0]) {
        message = `Patient already exists - DO NOT create duplicate. Use existing ID: ${patients[0].id}`;
      } else {
        message = `Found ${count} patients with this identifier - DO NOT create duplicate. Review existing records.`;
      }
    } else if (duplicateRisk === "high") {
      message = `Found ${count} matching patient(s). High risk of duplicate - review before creating.`;
    } else if (duplicateRisk === "medium") {
      message = `Found ${count} similar patient(s). Review matches before creating.`;
    }

    return {
      query,
      found,
      count,
      confidence,
      duplicateRisk,
      patients,
      message,
    };
  }

  /**
   * Calculate match confidence based on search type and result count
   */
  private calculateConfidence(searchType: SearchType, count: number): "high" | "medium" | "low" {
    if (count === 0) return "low";
    
    if (searchType === "identifier") {
      return "high"; // Identifier match is always high confidence
    }
    
    if (searchType === "demographics") {
      return count === 1 ? "high" : "medium"; // Single match = high confidence
    }
    
    if (searchType === "fuzzy") {
      return "medium"; // Fuzzy matches are medium confidence
    }
    
    return "medium"; // Flexible search is medium confidence
  }

  /**
   * Calculate duplicate risk based on search type and match count
   */
  private calculateDuplicateRisk(searchType: SearchType, count: number): DuplicateRisk {
    if (count === 0) return "none";
    
    // Identifier search
    if (searchType === "identifier") {
      return count > 0 ? "high" : "none"; // Any ID match = high risk
    }
    
    // Demographics search
    if (searchType === "demographics") {
      if (count >= 3) return "high";
      if (count === 2) return "medium";
      if (count === 1) return "medium"; // Even 1 match should be reviewed
      return "low";
    }
    
    // Fuzzy search
    if (searchType === "fuzzy") {
      if (count > 3) return "high";
      if (count >= 2) return "medium";
      return "low";
    }
    
    // Flexible search
    if (count >= 2) return "medium";
    return "low";
  }

  /**
   * Handle errors and send error response
   */
  private handleError(res: Response, err: unknown): void {
    const error = err as Error;
    console.error("[Patient Search] Error:", error);
    res.status(500).json({
      error: "Search failed",
      message: error.message,
    });
  }
}

