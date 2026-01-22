import { Router } from "express";
import { ObservationSearchController } from "../controllers/observation-search.js";
import type { AppConfig } from "../../config/index.js";

export function createObservationRoutes(config: AppConfig): Router {
  const router = Router();
  const controller = new ObservationSearchController(config);

  /**
   * Search observations by patient identifier
   * GET /api/observations/patient?patientId=XXX
   * GET /api/observations/patient?identifier=XXX
   * GET /api/observations/patient?identifier=09-0A-17-2026-N-00001&category=vital-signs
   * 
   * Supports multiple identifier formats:
   * - NEOTREE-IMPILO-ID: 09-0A-17-2026-N-00001
   * - Patient UUID: 1550f344-a98e-4f35-be87-51fa821d6e18
   * - Full identifier: urn:impilo:patient-id|1550f344-a98e-4f35-be87-51fa821d6e18
   * 
   * Optional filters:
   * - category: Filter by observation category
   * - code: Filter by observation code
   * - _lastUpdated: Filter by last updated date
   */
  router.get("/patient", (req, res) => {
    void controller.searchByPatient(req, res);
  });

  /**
   * Get a specific observation by ID
   * GET /api/observations/:id
   */
  router.get("/:id", (req, res) => {
    void controller.getById(req, res);
  });

  return router;
}

