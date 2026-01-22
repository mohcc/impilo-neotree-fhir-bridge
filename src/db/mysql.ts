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
  impilo_neotree_id: string | null; // Second highest priority identifier (from consultation.neonatal_care)
  neotree_id?: string | null; // Also available from neonatal_care (impilo_neotree_id takes precedence)
  nc_person_id?: string | null; // person_id from neonatal_care table (for reference)
  date_time_admission: Date | string;
  facility_id: string | null;
  person_id: string; // person_id from patient table (used for joins)
  // Fields from client.person table
  firstname: string;
  lastname: string;
  birthdate: Date | string;
  sex: string;
  // Address fields from client.person
  city?: string | null;
  street?: string | null;
  town_id?: string | null;
  town?: string | null;
  country_of_birth_id?: string | null;
  country_of_birth?: string | null;
  // Additional fields from client.person (available but not currently used)
  education_id?: string | null;
  education?: string | null;
  marital_id?: string | null;
  marital?: string | null;
  occupation_id?: string | null;
  occupation?: string | null;
  religion_id?: string | null;
  religion?: string | null;
  nationality_id?: string | null;
  nationality?: string | null;
  denomination_id?: string | null;
  denomination?: string | null;
  self_identified_gender?: string | null;
  expiration_date?: Date | string | null;
  member?: string | null;
  member_number?: string | null;
  provider_id?: string | null;
  provider?: string | null;
  // Fields from client.patient_identity table (LEFT JOIN - may be null)
  phid?: string | null; // Primary Health ID - highest priority identifier
  patient_identity_id?: string | null;
  patient_identity_date_created?: Date | string | null;
  patient_identity_date_updated?: Date | string | null;
  patient_identity_synced?: boolean | number | null;
  patient_identity_synced_date?: Date | string | null;
}

export async function fetchNeonatalCareWithDemographics(
  pool: Pool,
  watermarkExclusive: string | null,
  batchSize: number
): Promise<NeonatalCareWithDemographics[]> {
  // Watermark is stored as UTC string "YYYY-MM-DD HH:MM:SS"
  // Interpret the watermark string as UTC, then convert to CAT (Zimbabwe time, UTC+2) for comparison
  // Note: Database stores timestamps in CAT (Central Africa Time, UTC+2) - Zimbabwe timezone
  // Zimbabwe uses CAT which is UTC+2 (no daylight saving time changes)
  const where = watermarkExclusive
    ? "WHERE nc.date_time_admission > CONVERT_TZ(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), '+00:00', '+02:00')"
    : "";
  // Convert datetime from CAT to UTC before formatting to ensure consistent timezone handling
  // Using client.person table which contains all required fields including demographics and address
  // LEFT JOIN client.patient_identity to get phid (Primary Health ID) - highest priority identifier
  // SELECT * from client.person to get all fields (firstname, lastname, birthdate, sex, address fields, etc.)
  //
  // Fields from consultation.neonatal_care (nc):
  // - neonatal_care_id, patient_id, neotree_id, date_time_admission, impilo_neotree_id, person_id
  // Note: impilo_neotree_id is the second highest priority identifier (after phid)
  const sql = `
    SELECT 
      nc.neonatal_care_id,
      nc.patient_id,
      nc.impilo_neotree_id,  -- Second highest priority identifier (from neonatal_care table)
      nc.neotree_id,  -- Also available but impilo_neotree_id takes precedence
      nc.person_id as nc_person_id,  -- person_id from neonatal_care (for reference)
      DATE_FORMAT(
        CONVERT_TZ(nc.date_time_admission, '+02:00', '+00:00'),
        '%Y-%m-%d %H:%i:%s'
      ) as date_time_admission,
      p.facility_id,
      p.person_id,  -- person_id from patient table (used for joins)
      -- Select all fields from client.person (includes firstname, lastname, birthdate, sex, and all address fields)
      -- This replaces the previous person_demographic table join
      per.*,
      -- Select phid from client.patient_identity (LEFT JOIN - may be null if not available)
      -- phid is the HIGHEST priority identifier
      pi.phid,
      pi.id as patient_identity_id,
      pi.date_created as patient_identity_date_created,
      pi.date_updated as patient_identity_date_updated,
      pi.synced as patient_identity_synced,
      pi.synced_date as patient_identity_synced_date
    FROM \`consultation\`.\`neonatal_care\` nc
    INNER JOIN \`consultation\`.\`patient\` p ON nc.patient_id = p.patient_id
    INNER JOIN \`client\`.\`person\` per ON p.person_id = per.person_id
    LEFT JOIN \`client\`.\`patient_identity\` pi ON p.person_id = pi.person_id
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
  date: Date | string | null; // LocalDateTime column for watermark tracking (stored in CAT/Zimbabwe time UTC+2, converted to UTC for storage)
  date_time_admission: Date | string | null;
  // From neonatal_care join - for OpenCR lookup
  person_id: string | null;
  impilo_neotree_id: string | null;
}

export async function fetchNeonatalQuestions(
  pool: Pool,
  watermarkExclusive: string | null, // Last processed date (YYYY-MM-DD HH:MM:SS in UTC)
  batchSize: number
): Promise<NeonatalQuestionRow[]> {
  // Watermark is stored as UTC string "YYYY-MM-DD HH:MM:SS"
  // The watermark value represents the last processed datetime in UTC
  // 
  // Comparison logic for accurate datetime tracking (matches neonatal_care pattern):
  // 1. Parse watermark string and treat as UTC: STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')
  // 2. Convert watermark from UTC to CAT (Zimbabwe time): CONVERT_TZ(..., '+00:00', '+02:00')
  // 3. Compare: nq.date (in CAT/Zimbabwe) > watermark (converted to CAT)
  //
  // This ensures accurate tracking even if records are inserted out of order
  // Note: Database stores LocalDateTime in CAT (Central Africa Time, UTC+2) - Zimbabwe timezone
  // Zimbabwe uses CAT which is UTC+2 (no daylight saving time)
  const where = watermarkExclusive
    ? "WHERE nq.date > CONVERT_TZ(STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), '+00:00', '+02:00')"
    : "";
  
  // Convert datetime from CAT (Zimbabwe time, UTC+2) to UTC before formatting
  // The date column is stored as LocalDateTime in CAT timezone (Zimbabwe)
  // We convert it to UTC for watermark storage and comparison to ensure accuracy
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
      DATE_FORMAT(
        CONVERT_TZ(nq.date, '+02:00', '+00:00'),
        '%Y-%m-%d %H:%i:%s'
      ) as date,
      DATE_FORMAT(
        CONVERT_TZ(nc.date_time_admission, '+02:00', '+00:00'),
        '%Y-%m-%d %H:%i:%s'
      ) as date_time_admission,
      nc.person_id,
      nc.impilo_neotree_id
    FROM \`consultation\`.\`neonatal_question\` nq
    INNER JOIN \`consultation\`.\`neonatal_care\` nc 
      ON nq.neonatal_care_id = nc.neonatal_care_id
    ${where}
    ORDER BY CONVERT_TZ(nq.date, '+02:00', '+00:00'), nq.id
    LIMIT ?
  `;
  
  const params: Array<string | number> = [];
  if (watermarkExclusive) params.push(watermarkExclusive);
  params.push(batchSize);
  
  const [rows] = await pool.query<NeonatalQuestionRow[]>(sql, params);
  return rows;
}

