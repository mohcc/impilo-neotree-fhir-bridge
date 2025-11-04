import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().optional(),
  SOURCE_ID: z.string().default("opencr"),
  FACILITY_ID: z.string().optional(),
  FACILITY_NAME: z.string().optional(),

  MYSQL_HOST: z.string().optional(),
  MYSQL_PORT: z.string().optional(),
  MYSQL_USER: z.string().optional(),
  MYSQL_PASSWORD: z.string().optional(),
  MYSQL_DATABASE: z.string().optional(),
  MYSQL_DSN: z.string().optional(),

  OPENHIM_BASE_URL: z.string().url().optional(),
  OPENHIM_USERNAME: z.string().optional(),
  OPENHIM_PASSWORD: z.string().optional(),
  OPENHIM_CHANNEL_PATH: z.string().optional(),
  OPENHIM_CLIENT_ID: z.string().optional(),

  PUSH_BATCH_SIZE: z.string().optional(),
  PUSH_CONCURRENCY: z.string().optional(),
  MYSQL_POLL_INTERVAL_MS: z.string().optional(),
  MYSQL_WATERMARK_TABLE: z.string().optional(),
  PULL_MODE: z.enum(["webhook", "poll"]).optional(),
});

export type AppConfig = {
  port: number;
  sourceId: string;
  facilityId?: string;
  facilityName?: string;
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    dsn: string; // mysql://user:pass@host:port/db
  };
  openhim: {
    baseUrl: string;
    username?: string;
    password?: string;
    channelPath: string;
    clientId?: string;
  };
  ops: {
    pushBatchSize: number;
    pushConcurrency: number;
    pollIntervalMs: number;
    watermarkTable: string;
    pullMode: "webhook" | "poll";
  };
};

function buildMysqlDsn(values: z.infer<typeof envSchema>): string {
  if (values.MYSQL_DSN && values.MYSQL_DSN.trim().length > 0) return values.MYSQL_DSN;
  const host = values.MYSQL_HOST ?? "localhost";
  const port = Number(values.MYSQL_PORT ?? 3307);
  const user = values.MYSQL_USER ?? "root";
  const password = values.MYSQL_PASSWORD ?? "";
  const db = values.MYSQL_DATABASE ?? "mysql";
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return `mysql://${auth}@${host}:${port}/${db}`;
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  const port = Number(parsed.PORT ?? 3000);
  const mysqlPort = Number(parsed.MYSQL_PORT ?? 3307);
  return {
    port,
    sourceId: parsed.SOURCE_ID,
    facilityId: parsed.FACILITY_ID,
    facilityName: parsed.FACILITY_NAME,
    mysql: {
      host: parsed.MYSQL_HOST ?? "localhost",
      port: mysqlPort,
      user: parsed.MYSQL_USER ?? "root",
      password: parsed.MYSQL_PASSWORD ?? "",
      database: parsed.MYSQL_DATABASE ?? "mysql",
      dsn: buildMysqlDsn(parsed),
    },
    openhim: {
      baseUrl: parsed.OPENHIM_BASE_URL ?? "",
      username: parsed.OPENHIM_USERNAME,
      password: parsed.OPENHIM_PASSWORD,
      channelPath: parsed.OPENHIM_CHANNEL_PATH ?? "/opencr/fhir",
      clientId: parsed.OPENHIM_CLIENT_ID ?? parsed.SOURCE_ID,
    },
    ops: {
      pushBatchSize: Number(parsed.PUSH_BATCH_SIZE ?? 50),
      pushConcurrency: Number(parsed.PUSH_CONCURRENCY ?? 4),
      pollIntervalMs: Number(parsed.MYSQL_POLL_INTERVAL_MS ?? 60000),
      watermarkTable: parsed.MYSQL_WATERMARK_TABLE ?? "_watermarks",
      pullMode: (parsed.PULL_MODE as "webhook" | "poll") ?? "webhook",
    },
  };
}

