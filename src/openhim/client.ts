import type { AppConfig } from "../config/index.js";
import https from "https";
import http from "http";
import { URL } from "url";

export type HttpResult = { status: number; body: unknown };

export class OpenHimClient {
  private readonly baseUrl: string;
  private readonly authHeader?: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = config.openhim.baseUrl.replace(/\/$/, "");
    if (config.openhim.username && config.openhim.password) {
      const token = Buffer.from(`${config.openhim.username}:${config.openhim.password}`).toString("base64");
      this.authHeader = `Basic ${token}`;
    }
  }

  async postJson(path: string, payload: unknown, retries = 3): Promise<HttpResult> {
    const url = new URL(`${this.baseUrl}${path}`);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;
    const body = JSON.stringify(payload);
    
    let attempt = 0;
    let delayMs = 250;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await new Promise<HttpResult>((resolve, reject) => {
          const headers: Record<string, string | number> = {
            "content-type": "application/fhir+json",
            accept: "application/fhir+json",
            "content-length": Buffer.byteLength(body),
          };
          if (this.authHeader) headers.authorization = this.authHeader;
          if (this.config.openhim.clientId) headers["x-openhim-clientid"] = this.config.openhim.clientId;

          const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers,
          };

          const req = httpModule.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
              let parsedBody: unknown = undefined;
              try { parsedBody = data ? JSON.parse(data) : undefined; } catch { parsedBody = data; }
              // Log all responses for debugging
              if (res.statusCode && res.statusCode >= 400) {
                const bodyPreview = typeof parsedBody === 'string' 
                  ? parsedBody.substring(0, 500) 
                  : JSON.stringify(parsedBody).substring(0, 500);
                console.error(`[OpenHIM] HTTP ${res.statusCode} - Response: ${bodyPreview}`);
              }
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ status: res.statusCode, body: parsedBody });
              } else if (res.statusCode && attempt < retries) {
                reject(new Error(`HTTP ${res.statusCode}`));
              } else {
                resolve({ status: res.statusCode || 500, body: parsedBody });
              }
            });
          });

          req.on("error", reject);
          req.write(body);
          req.end();
        });

        return result;
      } catch (err) {
        attempt += 1;
        if (attempt > retries) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }
  }

  async postResource(path: string, resource: unknown): Promise<HttpResult> {
    return this.postJson(path, resource);
  }

  async postBundle(path: string, entries: unknown[]): Promise<HttpResult> {
    const bundle = { resourceType: "Bundle", type: "transaction", entry: entries };
    return this.postJson(path, bundle);
  }
}

