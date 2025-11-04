import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { logger } from "../observability/logger.js";

export async function writeDlq(payload: unknown, reason: unknown): Promise<void> {
  try {
    await fs.mkdir("dlq", { recursive: true });
    const id = randomUUID();
    const content = JSON.stringify({ reason: serializeError(reason), payload }, null, 2);
    await fs.writeFile(`dlq/${id}.json`, content, "utf8");
  } catch (e) {
    logger.error({ e }, "failed to write DLQ file");
  }
}

function serializeError(e: unknown): unknown {
  if (e instanceof Error) {
    return { message: e.message, stack: e.stack };
  }
  return e;
}

