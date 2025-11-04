# Neotree OpenCR FHIR Bridge - Complete System Walkthrough

## 📋 Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [Module Breakdown](#module-breakdown)
5. [Configuration](#configuration)
6. [Error Handling & Resilience](#error-handling--resilience)
7. [Key Features](#key-features)

---

## 🎯 System Overview

**Purpose**: This is a **FHIR Bridge** that synchronizes patient data from a **MySQL database** (Neotree/OpenCR source) to **OpenHIM/OpenCR** (FHIR-based patient registry).

**Core Functionality**:
- Polls MySQL database for new/updated neonatal care records
- Transforms MySQL rows into FHIR Patient resources
- Validates and sanitizes patient data
- Pushes validated patients to OpenHIM as FHIR bundles
- Tracks processing state using watermarks
- Handles errors with retries and Dead Letter Queue (DLQ)

**Technology Stack**:
- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Database**: MySQL (via `mysql2/promise`)
- **HTTP Client**: Native Node.js `http/https`
- **Logging**: Pino (structured JSON logging)
- **Metrics**: Prometheus (via `prom-client`)
- **Web Framework**: Express.js

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Entry Point                   │
│                      src/index.ts                            │
│  - Initializes Express server (health/metrics endpoints)    │
│  - Creates MySQL connection pool                            │
│  - Starts OpenCR push pipeline                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Configuration Layer                         │
│                  src/config/index.ts                         │
│  - Loads environment variables                               │
│  - Validates config with Zod                                │
│  - Builds MySQL DSN and AppConfig object                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Push Pipeline                             │
│                 src/push/pipeline.ts                        │
│  - Orchestrates polling, mapping, validation, pushing        │
│  - Manages retry logic with exponential backoff             │
│  - Processes OpenCR responses and audit logging             │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Database   │  │   Mapping     │  │  Validation  │
│   Layer      │  │   Layer       │  │  Layer       │
│              │  │               │  │              │
│ mysql.ts     │  │ patient.ts    │  │ validator.ts │
│              │  │               │  │              │
│ - Watermarks │  │ - MySQL → FHIR│  │ - FHIR R4    │
│ - Polling    │  │ - Identifiers │  │ - Neotree    │
│ - Queries    │  │ - Demographics│  │   rules     │
└──────────────┘  └──────────────┘  └──────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  OpenHIM Client                              │
│              src/openhim/client.ts                           │
│  - HTTP/HTTPS requests to OpenHIM                           │
│  - FHIR Bundle creation (transaction)                        │
│  - Basic auth & retry logic                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Observability & Error Handling                  │
│  - Logging (Pino): src/observability/logger.ts               │
│  - Metrics (Prometheus): src/observability/metrics.ts        │
│  - Audit Logging: src/audit/audit-logger.ts                 │
│  - Dead Letter Queue: src/push/dlq.ts                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow

### 1. **Application Startup** (`src/index.ts`)

```
1. Load configuration from environment variables
2. Create Express server with health/metrics endpoints
3. Create MySQL connection pool
4. Test MySQL connection
5. Start OpenCR push pipeline
```

### 2. **Polling Cycle** (`src/push/pipeline.ts`)

```
Every N seconds (default: 60s):
├─ 1. Get watermark (last processed timestamp)
├─ 2. Query MySQL for new records since watermark
│   └─ JOIN: consultation.neonatal_care + consultation.patient + report.person_demographic
├─ 3. If no new records → skip, wait for next poll
├─ 4. If records found:
│   ├─ Map each row → FHIR Patient resource
│   ├─ Sanitize patient data
│   ├─ Validate patient data
│   ├─ If invalid → write to DLQ, skip
│   ├─ Build FHIR Bundle with validated patients
│   ├─ Push to OpenHIM with retry logic
│   ├─ Process response (extract match info, audit log)
│   └─ Update watermark (last processed timestamp)
└─ 5. Continue polling
```

### 3. **Data Transformation** (`src/mapping/patient.ts`)

**MySQL Row → FHIR Patient Resource**:

```typescript
Input Row:
{
  neonatal_care_id: "123",
  patient_id: "P-456",
  neotree_id: "00-0A-34-2025-N-01031",  // NEOTREE-IMPILO-ID
  person_id: "789",
  firstname: "John",
  lastname: "Doe",
  birthdate: "2025-01-15",
  sex: "M",
  facility_id: "F-001",
  date_time_admission: "2025-01-15 10:30:00"
}

↓ PatientMapper.map() ↓

Output FHIR Patient:
{
  resourceType: "Patient",
  meta: {
    tag: [{ system: "http://openclientregistry.org/fhir/clientid", code: "opencr" }]
  },
  identifier: [
    { system: "urn:neotree:impilo-id", value: "00-0A-34-2025-N-01031" },
    { system: "urn:impilo:uid", value: "P-456" }
  ],
  name: [{ family: "Doe", given: ["John"] }],
  gender: "male",
  birthDate: "2025-01-15",
  managingOrganization: { reference: "Organization/F-001" }
}
```

### 4. **Validation Pipeline** (`src/validation/patient-validator.ts`)

**Validation Rules**:
- ✅ Resource type must be "Patient"
- ✅ At least one identifier required
- ✅ Identifier format validation (system + value)
- ✅ NEOTREE-IMPILO-ID format: `PP-DD-SS-YYYY-P-XXXXX`
- ✅ Birth date format: `YYYY-MM-DD`
- ✅ Birth date not in future, reasonable age
- ✅ Gender: one of `male`, `female`, `other`, `unknown`
- ✅ Managing organization reference format: `Organization/{id}`
- ⚠️ Warnings for missing recommended fields

**Sanitization**:
- Trims strings
- Removes control characters
- Normalizes whitespace

### 5. **OpenHIM Push** (`src/openhim/client.ts`)

**FHIR Bundle Structure**:
```json
{
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [
    {
      "request": { "method": "POST", "url": "Patient" },
      "resource": { /* FHIR Patient resource */ }
    }
  ]
}
```

**HTTP Request**:
- Method: `POST`
- URL: `{OPENHIM_BASE_URL}{OPENHIM_CHANNEL_PATH}`
- Headers:
  - `Content-Type: application/fhir+json`
  - `Accept: application/fhir+json`
  - `Authorization: Basic {base64(username:password)}`
  - `X-OpenHIM-ClientId: {clientId}` (optional)

**Response Processing**:
- Extracts patient registration status from bundle response
- Determines: `success`, `duplicate`, `validation_failed`, `error`
- Logs audit events for each patient

### 6. **Error Handling & Retry** (`src/push/pipeline.ts`)

**Retry Strategy**:
```
Attempt 1 → Fail (5xx error) → Wait 1s
Attempt 2 → Fail (5xx error) → Wait 2s
Attempt 3 → Fail (5xx error) → Wait 4s
Max retries exceeded → Write to DLQ
```

**Dead Letter Queue (DLQ)**:
- Failed messages written to `dlq/{uuid}.json`
- Contains: error details, full payload, table name
- Manual review/retry required

---

## 📦 Module Breakdown

### **1. Entry Point** (`src/index.ts`)

**Responsibilities**:
- Bootstrap application
- Initialize Express server
- Create MySQL connection pool
- Start push pipeline

**Key Code**:
```typescript
async function main() {
  const port = Number(process.env.PORT || 3000);
  const app = createServer();  // Health/metrics endpoints
  app.listen(port);
  
  const config = loadConfig();
  const pool = createPool(config);
  await pool.query("SELECT 1");  // Test connection
  
  await startOpencrPushPipeline(pool, config);  // Start polling
}
```

### **2. Configuration** (`src/config/index.ts`)

**Environment Variables**:
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `SOURCE_ID` | `opencr` | Client ID for OpenCR |
| `MYSQL_HOST` | `localhost` | MySQL host |
| `MYSQL_PORT` | `3307` | MySQL port |
| `MYSQL_USER` | `root` | MySQL user |
| `MYSQL_PASSWORD` | `""` | MySQL password |
| `MYSQL_DATABASE` | `mysql` | MySQL database |
| `OPENHIM_BASE_URL` | - | OpenHIM base URL |
| `OPENHIM_USERNAME` | - | OpenHIM username |
| `OPENHIM_PASSWORD` | - | OpenHIM password |
| `OPENHIM_CHANNEL_PATH` | `/opencr/fhir` | OpenHIM channel path |
| `PUSH_BATCH_SIZE` | `50` | Records per batch |
| `MYSQL_POLL_INTERVAL_MS` | `60000` | Poll interval (ms) |
| `MYSQL_WATERMARK_TABLE` | `_watermarks` | Watermark table name |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `LOG_FILE` | - | Optional log file path |

**Config Structure**:
```typescript
type AppConfig = {
  port: number;
  sourceId: string;
  mysql: { host, port, user, password, database, dsn };
  openhim: { baseUrl, username?, password?, channelPath, clientId? };
  ops: { pushBatchSize, pushConcurrency, pollIntervalMs, watermarkTable, pullMode };
};
```

### **3. Database Layer** (`src/db/mysql.ts`)

**Functions**:

#### **`createPool(config)`**
- Creates MySQL connection pool (max 10 connections)
- Uses connection pooling for efficiency

#### **`ensureWatermarkTable(pool, tableName)`**
- Creates watermark table if not exists:
  ```sql
  CREATE TABLE `_watermarks` (
    `key` VARCHAR(191) PRIMARY KEY,
    `value` VARCHAR(255) NOT NULL,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
  ```

#### **`getWatermark(pool, tableName, key)`**
- Retrieves last processed timestamp for a table
- Returns `null` if no watermark exists

#### **`setWatermark(pool, tableName, key, value)`**
- Updates watermark with new timestamp
- Uses `REPLACE INTO` (upsert)

#### **`fetchNeonatalCareWithDemographics(pool, watermark, batchSize)`**
- Joins `consultation.neonatal_care` + `consultation.patient` + `report.person_demographic`
- Filters by `date_time_admission > watermark`
- Orders by `date_time_admission, neonatal_care_id`
- Limits to `batchSize` records

**Query Example**:
```sql
SELECT 
  nc.neonatal_care_id,
  nc.patient_id,
  nc.neotree_id,
  DATE_FORMAT(nc.date_time_admission, '%Y-%m-%d %H:%i:%s') as date_time_admission,
  p.facility_id,
  p.person_id,
  pd.firstname,
  pd.lastname,
  pd.birthdate,
  pd.sex
FROM `consultation`.`neonatal_care` nc
INNER JOIN `consultation`.`patient` p ON nc.patient_id = p.patient_id
INNER JOIN `report`.`person_demographic` pd ON p.person_id = pd.person_id
WHERE nc.date_time_admission > ?
ORDER BY nc.date_time_admission, nc.neonatal_care_id
LIMIT ?
```

### **4. Mapping Layer** (`src/mapping/patient.ts`)

**PatientMapper Class**:

**`map(row: NeonatalCareRow): PatientResource`**

**Identifier Mapping**:
1. **NEOTREE-IMPILO-ID** (Primary): `urn:neotree:impilo-id`
   - Format: `PP-DD-SS-YYYY-P-XXXXX` (e.g., `00-0A-34-2025-N-01031`)
   - Highest priority for matching
2. **Patient ID** (Secondary): `urn:impilo:uid`
   - Required by OpenCR for internal ID

**Name Mapping**:
- `firstname` → `name[0].given[0]`
- `lastname` → `name[0].family`

**Gender Mapping**:
- `M` or `male` → `male`
- `F` or `female` → `female`
- Other → `unknown`

**Birth Date Mapping**:
- Converts to `YYYY-MM-DD` format (UTC)
- Validates date is not NaN

**Meta Tag**:
- Adds client ID tag: `{ system: "http://openclientregistry.org/fhir/clientid", code: clientId }`
- Required by OpenCR for client identification

### **5. Validation Layer** (`src/validation/patient-validator.ts`)

**PatientValidator Class**:

**`validate(patient: PatientResource): ValidationResult`**
- Returns: `{ valid: boolean, errors: string[], warnings: string[] }`
- Validates:
  - Resource type
  - Identifiers (required, format)
  - Names (recommended)
  - Birth date (format, reasonable)
  - Gender (valid values)
  - Managing organization (format)
  - NEOTREE-IMPILO-ID format (regex)

**`sanitize(patient: PatientResource): PatientResource`**
- Trims strings
- Removes control characters
- Normalizes whitespace

**`isValidNeotreeId(id: string): boolean`**
- Validates format: `PP-DD-SS-YYYY-P-XXXXX`
- Checks hex characters, year range (1900-2100), sequential number

### **6. Push Pipeline** (`src/push/pipeline.ts`)

**`startOpencrPushPipeline(pool, config)`**

**Main Loop**:
```typescript
setInterval(() => {
  pollAndProcess();
}, config.ops.pollIntervalMs);
```

**`pollAndProcess()` Function**:
1. Get watermark
2. Fetch new records
3. Map rows → FHIR Patients
4. Sanitize patients
5. Validate patients
6. Build bundle with validated entries
7. Push to OpenHIM with retry
8. Process response (audit logging)
9. Update watermark

**`pushWithRetry(path, entries, maxRetries)`**:
- Retries on 5xx errors
- Exponential backoff: 1s, 2s, 4s
- Logs transmission errors to audit logger

**`processResponse(response, entries)`**:
- Parses FHIR Bundle response
- Extracts registration status per patient
- Determines: `success`, `duplicate`, `validation_failed`, `error`
- Logs audit events

### **7. OpenHIM Client** (`src/openhim/client.ts`)

**OpenHimClient Class**:

**`postBundle(path, entries): Promise<HttpResult>`**
- Creates FHIR Bundle: `{ resourceType: "Bundle", type: "transaction", entry: entries }`
- Calls `postJson(path, bundle)`

**`postJson(path, payload, retries): Promise<HttpResult>`**
- Makes HTTP/HTTPS POST request
- Headers:
  - `Content-Type: application/fhir+json`
  - `Accept: application/fhir+json`
  - `Authorization: Basic {base64(username:password)}`
  - `X-OpenHIM-ClientId: {clientId}` (optional)
- Retries on network errors (exponential backoff)
- Returns: `{ status: number, body: unknown }`

**Error Handling**:
- Logs HTTP 4xx/5xx responses
- Retries on network errors
- Returns status code even on errors

### **8. Dead Letter Queue** (`src/push/dlq.ts`)

**`writeDlq(payload, reason): Promise<void>`**
- Creates `dlq/` directory if not exists
- Writes JSON file: `dlq/{uuid}.json`
- Contains:
  ```json
  {
    "reason": {
      "message": "Error message",
      "stack": "Error stack trace"
    },
    "payload": { /* Full payload */ }
  }
  ```

**Use Cases**:
- Validation failures
- Transmission errors after max retries
- Unexpected errors

### **9. Audit Logging** (`src/audit/audit-logger.ts`)

**AuditLogger Class**:

**Event Types**:
- `patient_registration`: Success/duplicate/error
- `duplicate_detected`: Duplicate match found
- `validation_error`: Validation failed
- `transmission_error`: Network/HTTP error

**`logPatientRegistration(patient, result)`**
- Logs structured event with:
  - Patient ID
  - OpenCR ID (if available)
  - Registration status
  - Timestamp
  - Metadata (identifier count, name, etc.)

**Log Levels**:
- `info`: Success
- `warn`: Duplicate
- `error`: Validation/transmission errors

### **10. Observability** (`src/observability/`)

#### **Logger** (`logger.ts`):
- Uses Pino for structured JSON logging
- Configurable log level via `LOG_LEVEL`
- Optional file logging via `LOG_FILE`
- Supports multi-stream (stdout + file)

#### **Metrics** (`metrics.ts`):
- Prometheus metrics via `prom-client`
- Endpoint: `GET /metrics`
- Default metrics: CPU, memory, event loop, etc.

### **11. HTTP Server** (`src/server.ts`)

**Endpoints**:
- `GET /health`: Returns `{ status: "ok" }`
- `GET /metrics`: Prometheus metrics (Prometheus format)

---

## ⚙️ Configuration

### **Environment Variables**

Create `.env` file:
```bash
# Server
PORT=3000
SOURCE_ID=opencr

# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3307
MYSQL_USER=root
MYSQL_PASSWORD=yourpassword
MYSQL_DATABASE=your_database

# OpenHIM
OPENHIM_BASE_URL=https://openhim.example.com
OPENHIM_USERNAME=your_username
OPENHIM_PASSWORD=your_password
OPENHIM_CHANNEL_PATH=/opencr/fhir

# Operations
PUSH_BATCH_SIZE=50
MYSQL_POLL_INTERVAL_MS=60000
MYSQL_WATERMARK_TABLE=_watermarks

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/app.log
```

### **Startup Commands**

```bash
# Development (with auto-reload)
npm run dev

# Production (after build)
npm run build
npm start

# Pretty logs
npm run start:pretty
```

---

## 🛡️ Error Handling & Resilience

### **Retry Strategy**
- **Network errors**: Retry with exponential backoff (1s, 2s, 4s)
- **5xx errors**: Retry up to max retries
- **4xx errors**: No retry (client error)

### **Watermark System**
- Tracks last processed `date_time_admission` per table
- Prevents duplicate processing
- Resumable after crashes

### **Dead Letter Queue**
- Failed messages saved to `dlq/` directory
- Manual review/retry required
- Contains full error context

### **Validation**
- Validates before sending to OpenHIM
- Invalid patients skipped (not sent)
- Writes validation failures to DLQ

### **Audit Logging**
- All registration events logged
- Tracks success/duplicate/error status
- Includes metadata for debugging

---

## ✨ Key Features

### **1. Incremental Sync**
- Uses watermarks to track progress
- Only processes new/changed records
- Efficient for large datasets

### **2. Batch Processing**
- Processes records in batches (default: 50)
- Configurable batch size
- Reduces API calls

### **3. FHIR R4 Compliance**
- Valid FHIR Patient resources
- Transaction bundles for batch operations
- Proper identifier systems

### **4. OpenCR Integration**
- Client ID tagging for source identification
- NEOTREE-IMPILO-ID support (highest priority)
- Duplicate detection support

### **5. Observability**
- Structured logging (Pino)
- Prometheus metrics
- Audit trail for all operations

### **6. Resilience**
- Retry logic with backoff
- Dead Letter Queue for failures
- Watermark persistence

---

## 🔍 Debugging

### **View Logs**
```bash
# View logs with pretty formatting
tail -f logs/app.log | npx pino-pretty

# View raw JSON logs
cat logs/app.log
```

### **Check Watermarks**
```sql
SELECT * FROM `_watermarks`;
```

### **View DLQ**
```bash
ls -la dlq/
cat dlq/*.json
```

### **Check Metrics**
```bash
curl http://localhost:3000/metrics
```

### **Health Check**
```bash
curl http://localhost:3000/health
```

---

## 📝 Notes

- **Poller Class** (`src/push/poller.ts`): Generic poller (currently unused, pipeline uses custom polling)
- **Type Safety**: Full TypeScript with strict types
- **Error Swallowing**: Poller swallows errors to continue polling (errors logged)
- **Fetch Issue**: Currently uses native `http/https`, not `fetch` (Node.js 18+ has fetch, but may need polyfill)

---

## 🚀 Next Steps / Improvements

1. **Add webhook support** (currently only polling)
2. **Add more table pollers** (neonatal_question when it has timestamp)
3. **Add DLQ retry mechanism** (automatic retry of DLQ items)
4. **Add monitoring dashboard** (Grafana for Prometheus metrics)
5. **Add unit tests** (Jest/Vitest)
6. **Add integration tests** (test DB, mock OpenHIM)
7. **Add Docker Compose** (for local development)

---

This walkthrough covers the entire system architecture and data flow. For specific implementation details, refer to the source code files.

