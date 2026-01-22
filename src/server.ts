import express, { Request, Response } from "express";
import { metricsHandler } from "./observability/metrics.js";
import { createPatientRoutes } from "./api/routes/patients.js";
import { createObservationRoutes } from "./api/routes/observations.js";
import type { AppConfig } from "./config/index.js";

export function createServer(config?: AppConfig) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/metrics", metricsHandler);

  // Mount patient search routes if config is provided
  if (config) {
    const patientRoutes = createPatientRoutes(config);
    app.use("/api/patients", patientRoutes);
    
    // Mount observation search routes
    const observationRoutes = createObservationRoutes(config);
    app.use("/api/observations", observationRoutes);
  }

  return app;
}

