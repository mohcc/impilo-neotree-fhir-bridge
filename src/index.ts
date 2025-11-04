import { createServer } from "./server.js";
import { loadConfig } from "./config/index.js";
import { createPool } from "./db/mysql.js";
import { startOpencrPushPipeline } from "./push/pipeline.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const port = Number(process.env.PORT || 3000);
  const app = createServer(config);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Service listening on port ${port}`);
  });

  const pool = createPool(config);
  
  // Test MySQL connection
  try {
    await pool.query("SELECT 1");
    // eslint-disable-next-line no-console
    console.log("✅ Connected to MySQL");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  }
  
  await startOpencrPushPipeline(pool, config);
}

void main();

