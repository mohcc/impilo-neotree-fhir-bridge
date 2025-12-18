import { Router } from "express";
import { PatientSearchController } from "../controllers/patient-search.js";
import type { AppConfig } from "../../config/index.js";

export function createPatientRoutes(config: AppConfig): Router {
  const router = Router();
  const controller = new PatientSearchController(config);

  /**
   * Search by identifier (NEOTREE-IMPILO-ID or Patient ID)
   * GET /api/patients/search/by-identifier?identifier=00-0A-34-2025-N-01036
   */
  router.get("/search/by-identifier", (req, res) => {
    void controller.searchByIdentifier(req, res);
  });

  /**
   * Search by demographics (name, DOB, gender)
   * GET /api/patients/search/by-demographics?given=Tawanda&family=Kasaira&birthDate=1984-08-11&gender=male
   */
  router.get("/search/by-demographics", (req, res) => {
    void controller.searchByDemographics(req, res);
  });

  /**
   * Fuzzy search (handles name variations)
   * GET /api/patients/search/fuzzy?given=Tawanda&family=Kasaira&birthDate=1984-08-11&threshold=0.85
   */
  router.get("/search/fuzzy", (req, res) => {
    void controller.searchFuzzy(req, res);
  });

  /**
   * Smart name search - accepts full name and tries both orderings
   * GET /api/patients/search/by-name?name=dube anna&birthDate=1990-01-01
   */
  router.get("/search/by-name", (req, res) => {
    void controller.searchByName(req, res);
  });

  /**
   * Flexible search with any combination of parameters
   * GET /api/patients/search?identifier=XXX&given=Y&family=Z&birthDate=W&gender=V
   */
  router.get("/search", (req, res) => {
    void controller.search(req, res);
  });

  return router;
}

