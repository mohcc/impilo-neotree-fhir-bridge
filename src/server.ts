import express, { Request, Response } from "express";
import { metricsHandler } from "./observability/metrics.js";

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/metrics", metricsHandler);

  return app;
}

