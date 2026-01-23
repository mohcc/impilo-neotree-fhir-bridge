import { Pool, RowDataPacket } from "mysql2/promise";
import { logger } from "../observability/logger.js";
import type { NeonatalQuestionRow } from "../db/mysql.js";

/**
 * Queue system for observations where patient doesn't exist in OpenCR yet
 * Stores in database table for persistence and retry
 */
export class ObservationQueue {
  private readonly pool: Pool;
  private readonly queueTable: string;

  constructor(pool: Pool, queueTable = "_observation_queue") {
    this.pool = pool;
    this.queueTable = queueTable;
  }

  /**
   * Initialize queue table
   */
  async ensureQueueTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS \`${this.queueTable}\` (
        \`id\` VARCHAR(255) PRIMARY KEY,
        \`patient_id\` VARCHAR(255) NOT NULL,
        \`observation_data\` JSON NOT NULL,
        \`neonatal_question_id\` VARCHAR(255) NOT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`retry_count\` INT NOT NULL DEFAULT 0,
        \`last_retry_at\` TIMESTAMP NULL,
        \`status\` ENUM('pending', 'processing', 'failed', 'expired') NOT NULL DEFAULT 'pending',
        INDEX idx_patient_id (\`patient_id\`),
        INDEX idx_status (\`status\`),
        INDEX idx_created_at (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;
    await this.pool.query(sql);
  }

  /**
   * Add observations to queue
   */
  async enqueue(patientId: string, observations: NeonatalQuestionRow[]): Promise<void> {
    for (const obs of observations) {
      try {
        const sql = `
          INSERT INTO \`${this.queueTable}\`
          (\`id\`, \`patient_id\`, \`observation_data\`, \`neonatal_question_id\`, \`status\`)
          VALUES (?, ?, ?, ?, 'pending')
          ON DUPLICATE KEY UPDATE
            \`retry_count\` = \`retry_count\` + 1,
            \`last_retry_at\` = CURRENT_TIMESTAMP
        `;
        
        await this.pool.query(sql, [
          obs.id,
          patientId,
          JSON.stringify(obs),
          obs.id
        ]);
        
        logger.info(
          { patientId, observationId: obs.id, dataKey: obs.data_key },
          "Observation queued (patient not found in OpenCR)"
        );
      } catch (err) {
        logger.error(
          { err, patientId, observationId: obs.id },
          "Failed to queue observation"
        );
      }
    }
  }

  /**
   * Get queued observations for a patient
   */
  async getQueuedObservations(patientId: string): Promise<NeonatalQuestionRow[]> {
    const sql = `
      SELECT \`observation_data\`
      FROM \`${this.queueTable}\`
      WHERE \`patient_id\` = ? AND \`status\` = 'pending'
      ORDER BY \`created_at\`
    `;
    
    // MySQL returns JSON columns as objects (not strings)
    const [rows] = await this.pool.query<RowDataPacket[] & Array<{ observation_data: string | object }>>(sql, [patientId]);
    
    const validObservations: NeonatalQuestionRow[] = [];
    for (const row of rows) {
      try {
        // MySQL may return JSON as object or string depending on driver version
        const parsed = typeof row.observation_data === 'string' 
          ? JSON.parse(row.observation_data) as NeonatalQuestionRow
          : row.observation_data as NeonatalQuestionRow;
        validObservations.push(parsed);
      } catch (err) {
        const dataPreview = typeof row.observation_data === 'string' 
          ? row.observation_data.substring(0, 100)
          : JSON.stringify(row.observation_data).substring(0, 100);
        logger.error(
          { err, patientId, observationData: dataPreview },
          "Failed to parse queued observation data, skipping"
        );
        // Mark as failed so it doesn't keep retrying
        try {
          const obsData = typeof row.observation_data === 'string'
            ? JSON.parse(row.observation_data)
            : row.observation_data;
          if (obsData?.id) {
            await this.markFailed(obsData.id);
          }
        } catch {
          // Ignore parse errors here
        }
      }
    }
    
    return validObservations;
  }

  /**
   * Mark observation as processed (remove from queue)
   */
  async dequeue(observationId: string): Promise<void> {
    const sql = `
      DELETE FROM \`${this.queueTable}\`
      WHERE \`id\` = ?
    `;
    await this.pool.query(sql, [observationId]);
  }

  /**
   * Mark observation as failed (after max retries)
   */
  async markFailed(observationId: string): Promise<void> {
    const sql = `
      UPDATE \`${this.queueTable}\`
      SET \`status\` = 'failed'
      WHERE \`id\` = ?
    `;
    await this.pool.query(sql, [observationId]);
  }

  /**
   * Mark expired observations (older than 24 hours)
   */
  async markExpired(): Promise<number> {
    const sql = `
      UPDATE \`${this.queueTable}\`
      SET \`status\` = 'expired'
      WHERE \`status\` = 'pending'
        AND \`created_at\` < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `;
    const [result] = await this.pool.query(sql);
    return (result as any).affectedRows || 0;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    failed: number;
    expired: number;
  }> {
    const sql = `
      SELECT \`status\`, COUNT(*) as count
      FROM \`${this.queueTable}\`
      GROUP BY \`status\`
    `;
    const [rows] = await this.pool.query<RowDataPacket[] & Array<{ status: string; count: number }>>(sql);
    
    const stats = { pending: 0, failed: 0, expired: 0 };
    rows.forEach(row => {
      if (row.status === 'pending') stats.pending = row.count;
      if (row.status === 'failed') stats.failed = row.count;
      if (row.status === 'expired') stats.expired = row.count;
    });
    
    return stats;
  }

  /**
   * Get all patient IDs with pending observations in queue
   */
  async getPendingPatientIds(): Promise<string[]> {
    const sql = `
      SELECT DISTINCT \`patient_id\`
      FROM \`${this.queueTable}\`
      WHERE \`status\` = 'pending'
    `;
    const [rows] = await this.pool.query<RowDataPacket[] & Array<{ patient_id: string }>>(sql);
    return rows.map(row => row.patient_id);
  }

  /**
   * Get pending patients with their best identifiers (from neonatal_care join)
   * Returns array of { patient_id, impilo_neotree_id, person_id }
   */
  async getPendingPatientsWithIdentifiers(): Promise<Array<{
    patient_id: string;
    impilo_neotree_id: string | null;
    person_id: string | null;
  }>> {
    // Join queue with neonatal_care to get impilo_neotree_id and person_id
    const sql = `
      SELECT DISTINCT 
        q.patient_id,
        nc.impilo_neotree_id,
        nc.person_id
      FROM \`${this.queueTable}\` q
      INNER JOIN \`consultation\`.\`neonatal_care\` nc ON nc.patient_id = q.patient_id
      WHERE q.status = 'pending'
    `;
    const [rows] = await this.pool.query<RowDataPacket[] & Array<{
      patient_id: string;
      impilo_neotree_id: string | null;
      person_id: string | null;
    }>>(sql);
    return rows;
  }
}

