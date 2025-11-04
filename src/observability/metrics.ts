import client from "prom-client";
import { Request, Response } from "express";

// Default registry and common metrics
client.collectDefaultMetrics();

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5]
});

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
}

