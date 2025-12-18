import mysql, { Pool, RowDataPacket } from "mysql2/promise";
import { AppConfig } from "../config/index.js";

export function createPool(config: AppConfig): Pool {
  // DSN format: mysql://user:pass@host:port/db
  // mysql2/promise doesn't accept DSN directly for createPool, parse it or use fields.
  return mysql.createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
  });
}

export interface WatermarkRecord extends RowDataPacket {
  key: string;
  value: string;
  updated_at: Date;
}

export async function ensureWatermarkTable(pool: Pool, tableName: string): Promise<void> {
  const sql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
    \`key\` VARCHAR(191) PRIMARY KEY,
    \`value\` VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`;
  await pool.query(sql);
}

export async function getWatermark(pool: Pool, tableName: string, key: string): Promise<string | null> {
  const [rows] = await pool.query<WatermarkRecord[]>("SELECT `value` FROM `" + tableName + "` WHERE `key`=?", [key]);
  if (rows.length === 0) return null;
  const firstRow = rows[0];
  if (!firstRow) return null;
  return firstRow.value;
}

export async function setWatermark(pool: Pool, tableName: string, key: string, value: string): Promise<void> {
  await pool.query("REPLACE INTO `" + tableName + "`(`key`,`value`) VALUES(?,?)", [key, value]);
}

export type PollQueryConfig = {
  schema?: string;          // e.g., consultation
  table: string;            // e.g., neonatal_care
  idColumn: string;         // e.g., id
  updatedAtColumn: string;  // e.g., updated_at
  batchSize: number;        // e.g., 100
};

export interface ChangedRow extends RowDataPacket {
  // shape is dynamic; consumers map by column names
}

export async function fetchChangedRows(
  pool: Pool,
  q: PollQueryConfig,
  watermarkExclusive: string | null
): Promise<ChangedRow[]> {
  const qualifiedTable = q.schema ? `\`${q.schema}\`.\`${q.table}\`` : `\`${q.table}\``;
  const where = watermarkExclusive
    ? `WHERE \`${q.updatedAtColumn}\` > ?`
    : "";
  const sql = `SELECT * FROM ${qualifiedTable} ${where} ORDER BY \`${q.updatedAtColumn}\`, \`${q.idColumn}\` LIMIT ?`;
  const params: Array<string | number> = [];
  if (watermarkExclusive) params.push(watermarkExclusive);
  params.push(q.batchSize);
  const [rows] = await pool.query<ChangedRow[]>(sql, params);
  return rows;
}

export interface NeonatalCareWithDemographics extends RowDataPacket {
  neonatal_care_id: string;
  patient_id: string;
  impilo_neotree_id: string | null; // Changed from neotree_id
  date_time_admission: Date | string;
  facility_id: string | null;
  person_id: string;
  firstname: string;
  lastname: string;
  birthdate: Date | string;
  sex: string;
}

export async function fetchNeonatalCareWithDemographics(
  pool: Pool,
  watermarkExclusive: string | null,
  batchSize: number
): Promise<NeonatalCareWithDemographics[]> {
  const where = watermarkExclusive
    ? "WHERE nc.date_time_admission > STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')"
    : "";
  // Note: STR_TO_DATE converts string to DATETIME, comparison is done in MySQL's timezone
  const sql = `
    SELECT 
      nc.neonatal_care_id,
      nc.patient_id,
      nc.impilo_neotree_id,
      DATE_FORMAT(nc.date_time_admission, '%Y-%m-%d %H:%i:%s') as date_time_admission,
      p.facility_id,
      p.person_id,
      pd.firstname,
      pd.lastname,
      pd.birthdate,
      pd.sex
    FROM \`consultation\`.\`neonatal_care\` nc
    INNER JOIN \`consultation\`.\`patient\` p ON nc.patient_id = p.patient_id
    INNER JOIN \`report\`.\`person_demographic\` pd ON p.person_id = pd.person_id
    ${where}
    ORDER BY nc.date_time_admission, nc.neonatal_care_id
    LIMIT ?
  `;
  const params: Array<string | number> = [];
  if (watermarkExclusive) params.push(watermarkExclusive);
  params.push(batchSize);
  const [rows] = await pool.query<NeonatalCareWithDemographics[]>(sql, params);
  return rows;
}

export interface NeonatalQuestionRow extends RowDataPacket {
  id: string;
  reference_id: string | null;
  category: string;
  category_id: number | null;
  script_id: string | null;
  screen_id: string | null;
  type: string;
  data_key: string;
  neonatal_care_id: string;
  patient_id: string;
  data: string; // JSON string
  display_key: string | null;
  display_value: string | null;
  display_order: number | null;
  date_time_admission: Date | string | null;
}

export async function fetchNeonatalQuestions(
  pool: Pool,
  watermarkExclusive: string | null, // Last processed ID
  batchSize: number
): Promise<NeonatalQuestionRow[]> {
  const where = watermarkExclusive
    ? "WHERE nq.id > ?"
    : "";
  
  const sql = `
    SELECT 
      nq.id,
      nq.reference_id,
      nq.category,
      nq.category_id,
      nq.script_id,
      nq.screen_id,
      nq.type,
      nq.data_key,
      nq.neonatal_care_id,
      nq.patient_id,
      nq.data,
      nq.display_key,
      nq.display_value,
      nq.display_order,
      DATE_FORMAT(nc.date_time_admission, '%Y-%m-%d %H:%i:%s') as date_time_admission
    FROM \`consultation\`.\`neonatal_question\` nq
    INNER JOIN \`consultation\`.\`neonatal_care\` nc 
      ON nq.neonatal_care_id = nc.neonatal_care_id
    ${where}
    ORDER BY nq.id
    LIMIT ?
  `;
  
  const params: Array<string | number> = [];
  if (watermarkExclusive) params.push(watermarkExclusive);
  params.push(batchSize);
  
  const [rows] = await pool.query<NeonatalQuestionRow[]>(sql, params);
  return rows;
}

