import { Pool } from "mysql2/promise";
import { fetchChangedRows, getWatermark, setWatermark, PollQueryConfig } from "../db/mysql.js";

export type PollerOptions = {
  watermarkTable: string;
  watermarkKey: string; // e.g., table name
  intervalMs: number;
  query: PollQueryConfig;
  onRows: (rows: any[]) => Promise<void>;
};

export class Poller {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly pool: Pool, private readonly opts: PollerOptions) {}

  public start(): void {
    if (this.timer) return;
    const run = async () => {
      try {
        const current = await getWatermark(this.pool, this.opts.watermarkTable, this.opts.watermarkKey);
        const rows = await fetchChangedRows(this.pool, this.opts.query, current);
        if (rows.length === 0) return;
        await this.opts.onRows(rows);
        const last = rows[rows.length - 1] as Record<string, unknown>;
        const lastUpdated = String(last[this.opts.query.updatedAtColumn]);
        await setWatermark(this.pool, this.opts.watermarkTable, this.opts.watermarkKey, lastUpdated);
      } catch {
        // swallow errors; outer loop continues
      }
    };
    this.timer = setInterval(() => { void run(); }, this.opts.intervalMs);
    void run();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

