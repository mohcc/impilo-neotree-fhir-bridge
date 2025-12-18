import type { AppConfig } from "../config/index.js";
import https from "https";
import http from "http";
import { URL } from "url";

export type HttpResult = { status: number; body: unknown };

export class OpenHimClient {
  public readonly baseUrl: string; // Made public for logging
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

  async putResource(path: string, resourceId: string, resource: unknown): Promise<HttpResult> {
    const url = new URL(`${this.baseUrl}${path}/${resourceId}`);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;
    const body = JSON.stringify(resource);
    
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
            method: "PUT",
            headers,
          };

          const req = httpModule.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
              let parsedBody: unknown = undefined;
              try { parsedBody = data ? JSON.parse(data) : undefined; } catch { parsedBody = data; }
              if (res.statusCode && res.statusCode >= 400) {
                const bodyPreview = typeof parsedBody === 'string' 
                  ? parsedBody.substring(0, 500) 
                  : JSON.stringify(parsedBody).substring(0, 500);
                console.error(`[OpenHIM] HTTP ${res.statusCode} - Response: ${bodyPreview}`);
              }
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ status: res.statusCode, body: parsedBody });
              } else if (res.statusCode && attempt < 3) {
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
        if (attempt > 3) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }
  }

  async postBundle(path: string, entries: unknown[]): Promise<HttpResult> {
    const bundle = { resourceType: "Bundle", type: "transaction", entry: entries };
    return this.postJson(path, bundle);
  }

  async get(path: string, retries = 3): Promise<HttpResult> {
    const url = new URL(`${this.baseUrl}${path}`);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;
    
    const fullUrl = `${this.baseUrl}${path}`;
    console.log(`[OpenHIM Client] GET request to: ${fullUrl}`);
    
    let attempt = 0;
    let delayMs = 250;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await new Promise<HttpResult>((resolve, reject) => {
          const headers: Record<string, string> = {
            accept: "application/fhir+json",
          };
          if (this.authHeader) headers.authorization = this.authHeader;
          if (this.config.openhim.clientId) headers["x-openhim-clientid"] = this.config.openhim.clientId;

          const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: "GET",
            headers,
          };
          
          console.log(`[OpenHIM Client] Request options:`, {
            method: options.method,
            hostname: options.hostname,
            port: options.port,
            path: options.path,
            headers: { ...headers, authorization: headers.authorization ? "[REDACTED]" : undefined }
          });

          const req = httpModule.request(options, (res) => {
            let data = "";
            console.log(`[OpenHIM Client] Response received: ${res.statusCode} for ${fullUrl}`);
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
              let parsedBody: unknown = undefined;
              try { parsedBody = data ? JSON.parse(data) : undefined; } catch { parsedBody = data; }
              
              if (res.statusCode && res.statusCode >= 400) {
                const bodyPreview = typeof parsedBody === 'string' 
                  ? parsedBody.substring(0, 500) 
                  : JSON.stringify(parsedBody).substring(0, 500);
                console.error(`[OpenHIM Client] HTTP ${res.statusCode} - Response: ${bodyPreview}`);
              } else {
                const bundle = parsedBody as { resourceType?: string; total?: number; entry?: unknown[] };
                if (bundle?.resourceType === "Bundle") {
                  console.log(`[OpenHIM Client] Bundle response: total=${bundle.total}, entries=${bundle.entry?.length || 0}`);
                }
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

          req.on("error", (err) => {
            console.error(`[OpenHIM Client] Request error for ${fullUrl}:`, err);
            reject(err);
          });
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
}

