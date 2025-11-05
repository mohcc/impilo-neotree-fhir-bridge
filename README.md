# Impilo-Neotree FHIR Bridge

> **Automated patient data synchronization from Neotree to OpenCR via OpenHIM**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)

## 📋 Overview

The **Impilo-Neotree FHIR Bridge** is a Node.js service that automatically synchronizes neonatal patient data from a MySQL database to OpenCR (Open Client Registry) via OpenHIM (Open Health Information Mediator). It transforms MySQL records into FHIR R4 Patient resources, validates them, and pushes them to the health information exchange infrastructure.

### Key Features

- 🔄 **Automated Polling**: Continuously monitors MySQL for new/updated patient records
- 🏥 **FHIR R4 Compliant**: Transforms data into standard FHIR Patient resources
- ✅ **Data Validation**: Comprehensive validation before sending to OpenCR
- 🔐 **Secure Authentication**: Basic auth and client ID headers for OpenHIM
- 📊 **Observability**: Structured logging (Pino) and Prometheus metrics
- 🔁 **Resilient**: Automatic retries with exponential backoff
- 💾 **Watermark Tracking**: Incremental sync using database watermarks
- 🚨 **Error Handling**: Dead Letter Queue (DLQ) for failed records
- 🎯 **Unique Identifiers**: Supports NEOTREE-IMPILO-ID format

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: >= 20.0.0
- **MySQL**: 5.7+ (accessible via network)
- **OpenHIM**: Running instance with configured channel
- **OpenCR**: Client registry with FHIR endpoint

### Installation

```bash
# Clone the repository
git clone https://github.com/mohcc/impilo-neotree-fhir-bridge.git
cd impilo-neotree-fhir-bridge

# Install dependencies
npm install

# Create configuration from template
cp env.example .env
# Edit .env with your credentials and endpoints

# Build TypeScript
npm run build

# Start the bridge
npm start
```

### Using the Management Script

```bash
# Start the bridge
./scripts/manage.sh start

# Stop the bridge
./scripts/manage.sh stop

# Restart the bridge
./scripts/manage.sh restart

# Check status
./scripts/manage.sh status

# Follow logs
./scripts/manage.sh logs
```

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project root (use `env.example` as template):

```bash
# Server Configuration
PORT=3001
SOURCE_ID=neotree-bridge

# Facility Configuration
FACILITY_ID=ZW000A42                           # OpenCR client ID (shows as "source")
FACILITY_NAME=Western Triangle Primary Care Clinic

# MySQL Database
MYSQL_HOST=localhost
MYSQL_PORT=3307
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=consultation

# OpenHIM Configuration
OPENHIM_BASE_URL=http://localhost:5001         # OpenHIM Core API
OPENHIM_USERNAME=your_username
OPENHIM_PASSWORD=your_password
OPENHIM_CHANNEL_PATH=/CR/fhir                  # Channel route path

# Operational Settings
PUSH_BATCH_SIZE=50                             # Records per batch
PUSH_CONCURRENCY=4                             # Concurrent pushes
MYSQL_POLL_INTERVAL_MS=10000                   # Poll every 10 seconds
MYSQL_WATERMARK_TABLE=_watermarks              # Watermark table name
PULL_MODE=poll                                 # Polling mode
```

### OpenCR Decision Rules

The bridge includes decision rules for patient matching in `config/decisionRules.neotree.json`:

- **Deterministic matching**: Exact match on identifiers, names, DOB
- **Probabilistic matching**: Fuzzy match for name variations (Jaro-Winkler, Levenshtein)
- **Weighted scoring**: Prioritizes NEOTREE-ID (weight: 10), Patient ID (8), DOB (7), names (6/5)
- **Confidence thresholds**: Auto-link (≥8), Manual review (5-7), No match (<5)
- **Null handling**: Conservative (IDs), Moderate (names), Greedy (gender)

To use these rules in OpenCR, copy the file to OpenCR's config directory and restart OpenCR.

---

## 🏗️ Architecture

### System Components

```
┌──────────────────┐
│  MySQL Database  │  ← Neotree neonatal_care data
└────────┬─────────┘
         │ Polling (every 10s)
         ▼
┌──────────────────┐
│  FHIR Bridge     │  ← This application
│  (Node.js/TS)    │
│  - Map to FHIR   │
│  - Validate      │
│  - Push to HIM   │
└────────┬─────────┘
         │ HTTP POST
         ▼
┌──────────────────┐
│     OpenHIM      │  ← Health Information Mediator
│  (Port 5001)     │
└────────┬─────────┘
         │ Route
         ▼
┌──────────────────┐
│     OpenCR       │  ← Client Registry
│  - HAPI FHIR     │
│  - Elasticsearch │
│  - Matching      │
└──────────────────┘
```

### Data Flow

1. **Poll MySQL**: Fetch new records from `neonatal_care` table (with JOINs to `patient` and `person_demographic`)
2. **Transform**: Map MySQL rows to FHIR Patient resources
3. **Validate**: Check FHIR compliance and Neotree business rules
4. **Push**: Send to OpenHIM with retry logic
5. **Track**: Update watermark for incremental sync
6. **Audit**: Log all operations for troubleshooting

---

## 📁 Project Structure

```
impilo-neotree-fhir-bridge/
├── src/                          # TypeScript source code
│   ├── index.ts                  # Application entry point
│   ├── server.ts                 # Express server (health, metrics)
│   ├── config/
│   │   └── index.ts              # Configuration loader (env vars)
│   ├── db/
│   │   └── mysql.ts              # MySQL client, watermarks, queries
│   ├── mapping/
│   │   ├── patient.ts            # MySQL → FHIR Patient mapper
│   │   └── types.ts              # TypeScript interfaces
│   ├── validation/
│   │   └── patient-validator.ts  # FHIR validation & sanitization
│   ├── push/
│   │   ├── pipeline.ts           # Main orchestration logic
│   │   ├── poller.ts             # Polling utilities
│   │   └── dlq.ts                # Dead Letter Queue
│   ├── openhim/
│   │   └── client.ts             # OpenHIM HTTP client
│   ├── observability/
│   │   ├── logger.ts             # Pino structured logging
│   │   └── metrics.ts            # Prometheus metrics
│   └── audit/
│       └── audit-logger.ts       # Audit trail logging
├── config/
│   └── decisionRules.neotree.json # OpenCR matching rules
├── scripts/
│   ├── manage.sh                 # Start/stop/restart script
│   ├── insert-test-record.sql    # Test data insertion
│   └── migrations/
│       └── add-neotree-id-column.sql # Schema migration
├── dist/                         # Compiled JavaScript (generated)
├── env.example                   # Environment config template
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── Dockerfile                    # Container image
├── SYSTEM_WALKTHROUGH.md         # Detailed technical docs
├── MATCHING_TEST_GUIDE.md        # Matching algorithm guide
└── README.md                     # This file
```

---

## 🔧 Development

### Build

```bash
npm run build
```

Compiles TypeScript from `src/` to `dist/`.

### Linting

```bash
npm run lint
```

Runs ESLint on TypeScript source files.

### Start with Pretty Logs

```bash
npm run start:pretty
```

Formats JSON logs for easier reading during development.

---

## 📊 Patient Data Mapping

### MySQL Schema (Source)

The bridge queries data from three tables:

```sql
-- Main table
SELECT 
  nc.neonatal_care_id,
  nc.patient_id,
  nc.neotree_id,                  -- NEOTREE-IMPILO-ID
  nc.date_time_admission,
  p.facility_id,
  p.person_id,
  pd.firstname,                   -- Demographics
  pd.lastname,
  pd.birthdate,
  pd.sex
FROM consultation.neonatal_care nc
INNER JOIN consultation.patient p ON nc.patient_id = p.patient_id
INNER JOIN report.person_demographic pd ON p.person_id = pd.person_id
```

### FHIR Patient Resource (Output)

```json
{
  "resourceType": "Patient",
  "meta": {
    "tag": [{
      "system": "http://openclientregistry.org/fhir/clientid",
      "code": "ZW000A42"
    }]
  },
  "identifier": [
    {
      "system": "urn:neotree:impilo-id",
      "value": "00-0A-34-2025-N-01036"
    },
    {
      "system": "urn:impilo:uid",
      "value": "db19831b-0ec8-4820-acf5-e03a7ee473f9"
    }
  ],
  "name": [{
    "use": "official",
    "family": "Kasaira",
    "given": ["Tawanda"]
  }],
  "gender": "male",
  "birthDate": "1984-08-11",
  "managingOrganization": {
    "reference": "Organization/ZW000A42"
  }
}
```

### Field Mappings

| MySQL Field | FHIR Path | Notes |
|-------------|-----------|-------|
| `neotree_id` | `identifier[0].value` | System: `urn:neotree:impilo-id` |
| `patient_id` | `identifier[1].value` | System: `urn:impilo:uid` |
| `firstname` | `name[0].given[0]` | Array of given names |
| `lastname` | `name[0].family` | Single family name |
| `sex` | `gender` | Normalized: M→male, F→female |
| `birthdate` | `birthDate` | Format: YYYY-MM-DD |
| `facility_id` | `managingOrganization.reference` | Organization reference |
| `facility_id` | `meta.tag[0].code` | Client ID for OpenCR |

---

## 🔍 Monitoring & Observability

### Health Check

```bash
curl http://localhost:3001/health
# Response: {"status":"ok"}
```

### Prometheus Metrics

```bash
curl http://localhost:3001/metrics
```

Available metrics:
- Process CPU/memory usage
- Custom application metrics (TBD)

### Logs

Structured JSON logs via Pino:

```bash
# Follow logs
tail -f /tmp/bridge.log

# Pretty print logs
npm run start:pretty

# Filter specific events
tail -f /tmp/bridge.log | grep '"msg":"pushed patient"'
```

Log levels: `debug`, `info`, `warn`, `error`

---

## 🧪 Testing

### Test Patient Matching

See [MATCHING_TEST_GUIDE.md](MATCHING_TEST_GUIDE.md) for comprehensive testing scenarios.

### Insert Test Record

```bash
# Use the provided SQL script
docker exec mysql mysql -u root -D consultation < scripts/insert-test-record.sql

# Wait for next poll cycle (10 seconds)
# Check logs for processing
tail -f /tmp/bridge.log
```

### Verify in OpenCR CRUX

1. Open OpenCR Console: `http://your-openhim-host:9000`
2. Navigate to **Client Registry** → **View Patients**
3. Verify patient appears with:
   - Given name and family name visible
   - Source: Your facility name (e.g., "Western Triangle Primary Care Clinic")
   - Identifiers: NEOTREE-IMPILO-ID and Patient ID

---

## 🛡️ Error Handling

### Retry Logic

- Failed HTTP requests: 3 retries with exponential backoff (250ms, 500ms, 1000ms)
- MySQL connection errors: Application exits (restart via systemd/Docker)

### Dead Letter Queue (DLQ)

Failed records are written to `dlq/` directory for manual review:

```bash
# Check DLQ
ls -lh dlq/

# Review failed record
cat dlq/2025-11-04T10-30-15-123Z.json
```

### Validation Failures

Patients that fail validation are:
1. Logged with detailed error messages
2. Written to DLQ
3. Skipped (not sent to OpenHIM)
4. Audited for later investigation

---

## 🔐 Security

### Credentials Management

- **Never commit `.env` file** (already in `.gitignore`)
- Use `env.example` as template only
- Rotate OpenHIM credentials regularly
- Use environment variables in production

### Authentication

- **OpenHIM**: Basic authentication (`Authorization: Basic base64(user:pass)`)
- **Client ID**: Header `x-openhim-clientid` for channel routing
- **MySQL**: Standard MySQL user authentication

---

## 📦 Deployment

### Docker Deployment

```bash
# Build image
docker build -t impilo-neotree-bridge .

# Run container
docker run -d \
  --name neotree-bridge \
  --env-file .env \
  -p 3001:3001 \
  impilo-neotree-bridge
```

### Docker Hub Build & Push

Use the provided scripts to build and publish images to Docker Hub.

```bash
# Build only (tags: latest, <package.json version>, <git sha>)
./scripts/docker-build.sh latest

# Build and push (requires Docker Hub login or env credentials)
# Option 1: already logged in (`docker login`)
./scripts/docker-build-push.sh latest

# Option 2: provide credentials via env
DOCKERHUB_USERNAME=youruser DOCKERHUB_TOKEN=yourtoken \
  ./scripts/docker-build-push.sh v0.1.0
```

Environment variables:
- `DOCKERHUB_REPO` (default: `mohcc/impilo-neotree-fhir-bridge`)
- `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (optional for non-interactive login)
- `BUILD_ARGS` (optional: forwarded to `docker build`)

### Production Checklist

- [ ] Set all required environment variables
- [ ] Configure FACILITY_ID for correct source display
- [ ] Verify MySQL connectivity and table schema
- [ ] Test OpenHIM channel authentication
- [ ] Set up monitoring/alerting for failed pushes
- [ ] Configure log rotation
- [ ] Set up systemd service or Docker restart policy
- [ ] Review and adjust poll interval for load
- [ ] Backup DLQ directory regularly

---

## 🤝 Contributing

### Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes and commit**:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Push to GitHub**:
   ```bash
   git push -u origin feature/your-feature-name
   ```

4. **Create Pull Request**:
   - Go to GitHub repository
   - Click "Compare & pull request"
   - Request review from team members
   - Merge after approval

### Commit Message Convention

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Add or update tests
- `chore:` Maintenance tasks

---

## 📚 Documentation

- **[SYSTEM_WALKTHROUGH.md](SYSTEM_WALKTHROUGH.md)**: Complete technical documentation
- **[MATCHING_TEST_GUIDE.md](MATCHING_TEST_GUIDE.md)**: OpenCR matching algorithm testing
- **[env.example](env.example)**: Configuration template with comments

---

## 🐛 Troubleshooting

### Bridge Not Starting

```bash
# Check MySQL connection
docker exec mysql mysql -u root -e "SELECT 1;"

# Check if port is in use
lsof -i :3001

# Review logs
tail -50 /tmp/bridge.log
```

### No Patients Being Sent

```bash
# Check watermark
docker exec mysql mysql -u root -D consultation -e "SELECT * FROM _watermarks;"

# Reset watermark to re-process all records
docker exec mysql mysql -u root -D consultation -e "DELETE FROM _watermarks;"

# Check for records
docker exec mysql mysql -u root -D consultation -e "SELECT COUNT(*) FROM neonatal_care;"
```

### OpenHIM Authentication Failures

```bash
# Test credentials manually
curl -i -u 'username:password' \
  -H 'content-type: application/fhir+json' \
  -H 'x-openhim-clientid: ZW000A42' \
  -d '{"resourceType":"Patient","name":[{"family":"Test"}]}' \
  http://openhim-host:5001/CR/fhir/Patient

# Check OpenHIM channel configuration
# Ensure channel path is exactly /CR/fhir
# Verify client credentials are allowed
```

### Patients Not Showing in OpenCR CRUX

1. **Check Elasticsearch indexing**:
   ```bash
   docker exec opencr-es curl 'http://localhost:9200/patients/_search?pretty'
   ```

2. **Verify FHIR structure**:
   - Names must have `use: "official"` field
   - `given` must be an array: `["Tawanda"]`
   - `family` must be a string: `"Kasaira"`

3. **Check OpenCR logs**:
   ```bash
   docker logs opencr --tail 100
   ```

---

## 📈 Performance

### Recommended Settings

| Environment | Poll Interval | Batch Size | Concurrency |
|-------------|---------------|------------|-------------|
| Development | 10000ms (10s) | 50 | 4 |
| Production | 60000ms (60s) | 100 | 8 |
| High Volume | 30000ms (30s) | 200 | 12 |

### Scaling Considerations

- **MySQL Connection Pool**: Default 10 connections (adjust in `src/db/mysql.ts`)
- **OpenHIM Rate Limiting**: Respect channel rate limits
- **Memory Usage**: ~50-100MB baseline, +20MB per 1000 patients in batch
- **CPU Usage**: Minimal (<5%) during idle, spikes during batch processing

---

## 🔒 Data Privacy

- Patient data is in-transit only (not stored by bridge)
- Logs contain patient IDs (ensure log files are secured)
- Audit logs track all operations for compliance
- DLQ contains failed patient data (secure this directory)

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🙋 Support

### Common Issues

1. **MySQL Connection Refused**
   - Check MySQL is running: `docker ps | grep mysql`
   - Verify port forwarding: `lsof -i :3307`
   - Check credentials in `.env`

2. **OpenHIM 401/403 Errors**
   - Verify username/password in `.env`
   - Check channel allows your client ID
   - Ensure channel path matches exactly

3. **Validation Errors**
   - Check DLQ directory: `ls -lh dlq/`
   - Review validation rules in `src/validation/patient-validator.ts`
   - Ensure NEOTREE-IMPILO-ID format: `PP-DD-SS-YYYY-P-XXXXX`

### Get Help

- Review documentation: `SYSTEM_WALKTHROUGH.md`
- Check logs: `./scripts/manage.sh logs`
- Verify configuration: `cat .env`

---

## 🔍 Search API

The bridge provides REST APIs to search OpenCR for existing patients before creating duplicates.

### Quick Example

```bash
# Check if patient exists by NEOTREE-ID
curl "http://localhost:3001/api/patients/search/by-identifier?identifier=00-0A-34-2025-N-01036"

# Search by demographics
curl "http://localhost:3001/api/patients/search/by-demographics?given=John&family=Doe&birthDate=1990-01-01"
```

### Available Endpoints

| Endpoint | Description | Use Case |
|----------|-------------|----------|
| `GET /api/patients/search/by-identifier` | Search by NEOTREE-ID or Patient ID | Exact match check |
| `GET /api/patients/search/by-demographics` | Search by name, DOB, gender | Pre-registration check |
| `GET /api/patients/search/fuzzy` | Fuzzy name matching | Handle typos/variations |
| `GET /api/patients/search` | Flexible combined search | Any combination |

**Response includes**:
- `duplicateRisk`: "none", "low", "medium", "high"
- `confidence`: Match confidence level
- `patients`: Simplified patient data
- `message`: Actionable guidance

See [SEARCH_API_GUIDE.md](SEARCH_API_GUIDE.md) for complete API documentation.

---

## 🚧 Roadmap

- [x] Pull/search functionality from OpenCR ✅
- [ ] Webhook mode for real-time sync
- [ ] Dashboard for monitoring
- [ ] Automated tests (unit + integration)
- [ ] Docker Compose for full stack
- [ ] CI/CD pipeline

---

## 👥 Authors

- **MoHCC Zimbabwe** - Ministry of Health and Child Care

---

## 🙏 Acknowledgments

- OpenCR (IntraHealth International)
- OpenHIM (Jembi Health Systems)
- HAPI FHIR Server
- Neotree Initiative

---

**Version**: 0.1.0  
**Last Updated**: November 2025


### Run Image from Docker Hub (Test Locally)

Create a minimal env file (adjust credentials/endpoints):

```bash
cat > /tmp/neotree.env << 'EOF'
PORT=3001
SOURCE_ID=neotree-bridge
FACILITY_ID=ZW000A42
FACILITY_NAME=Western Triangle Primary Care Clinic

# Host MySQL (macOS/Windows: host.docker.internal)
MYSQL_HOST=host.docker.internal
MYSQL_PORT=3307
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=consultation

# OpenHIM (example remote)
OPENHIM_BASE_URL=http://197.221.242.150:10343
OPENHIM_USERNAME=Impilo-Neotree
OPENHIM_PASSWORD=Password@1
OPENHIM_CHANNEL_PATH=/CR/fhir

# Ops
PUSH_BATCH_SIZE=10
PUSH_CONCURRENCY=2
MYSQL_POLL_INTERVAL_MS=10000
MYSQL_WATERMARK_TABLE=_watermarks
PULL_MODE=poll
EOF
```

Run the container (use 3002 on host in case 3001 is busy):

```bash
# If a previous test container exists
docker rm -f neotree-bridge-test 2>/dev/null || true

# Start
docker run -d \
  --name neotree-bridge-test \
  --env-file /tmp/neotree.env \
  -p 3002:3001 \
  mohcc/impilo-neotree-fhir-bridge:latest

# Health check
curl http://localhost:3002/health

# View logs
docker logs --tail 50 neotree-bridge-test
```

