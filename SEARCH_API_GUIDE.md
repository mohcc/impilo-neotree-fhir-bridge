# Patient Search API Guide

## Overview

The bridge provides RESTful search APIs to query OpenCR for existing patients before creating new records. All searches go through OpenHIM and return simplified patient data with duplicate risk assessment.

---

## API Endpoints

### Base URL
```
http://localhost:3001/api/patients
```

### 1. Search by Identifier

**Endpoint**: `GET /api/patients/search/by-identifier`

**Query Parameters**:
- `identifier` (required) - NEOTREE-IMPILO-ID or Patient ID

**Example**:
```bash
curl "http://localhost:3001/api/patients/search/by-identifier?identifier=00-0A-34-2025-N-01036"
```

**Response**:
```json
{
  "query": {
    "identifier": "00-0A-34-2025-N-01036"
  },
  "found": true,
  "count": 5,
  "confidence": "high",
  "duplicateRisk": "high",
  "patients": [
    {
      "id": "992e5081-aa46-4e56-86c5-e89e3ab004de",
      "identifiers": {
        "neotreeId": "00-0A-34-2025-N-01036",
        "patientId": "db19831b-0ec8-4820-acf5-e03a7ee473f9"
      },
      "name": {
        "given": "Tawanda",
        "family": "Kasaira"
      },
      "gender": "male",
      "birthDate": "1984-08-11",
      "facility": "ZW000A42",
      "source": "ZW000A42"
    }
  ],
  "message": "Found 5 matching patient(s). High risk of duplicate - review before creating."
}
```

---

### 2. Search by Demographics

**Endpoint**: `GET /api/patients/search/by-demographics`

**Query Parameters**:
- `given` (optional) - Given name
- `family` (optional) - Family name
- `birthDate` (optional) - Date of birth (YYYY-MM-DD)
- `gender` (optional) - Gender (male, female, other, unknown)

*At least one parameter required*

**Examples**:
```bash
# Full demographics
curl "http://localhost:3001/api/patients/search/by-demographics?given=Tawanda&family=Kasaira&birthDate=1984-08-11&gender=male"

# Name and DOB only
curl "http://localhost:3001/api/patients/search/by-demographics?given=John&family=Doe&birthDate=1990-01-01"

# DOB and gender
curl "http://localhost:3001/api/patients/search/by-demographics?birthDate=1984-08-11&gender=male"
```

**Response**:
```json
{
  "query": {
    "given": "Tawanda",
    "family": "Kasaira",
    "birthDate": "1984-08-11"
  },
  "found": true,
  "count": 1,
  "confidence": "high",
  "duplicateRisk": "medium",
  "patients": [...]
}
```

---

### 3. Fuzzy Search

**Endpoint**: `GET /api/patients/search/fuzzy`

**Query Parameters**:
- `given` (optional) - Given name
- `family` (optional) - Family name
- `birthDate` (optional) - Date of birth (YYYY-MM-DD)
- `threshold` (optional) - Similarity threshold (0.0-1.0, default: 0.85)

*Handles name variations and typos*

**Examples**:
```bash
# Fuzzy name match
curl "http://localhost:3001/api/patients/search/fuzzy?given=Jon&family=Smyth&birthDate=1990-01-01"

# With custom threshold
curl "http://localhost:3001/api/patients/search/fuzzy?given=John&family=Smith&threshold=0.9"
```

**Response**:
```json
{
  "query": {
    "given": "Jon",
    "family": "Smyth",
    "birthDate": "1990-01-01",
    "threshold": 0.85
  },
  "found": true,
  "count": 2,
  "confidence": "medium",
  "duplicateRisk": "medium",
  "patients": [...]
}
```

---

### 4. Flexible Search

**Endpoint**: `GET /api/patients/search`

**Query Parameters**: Any combination of:
- `identifier` - NEOTREE-IMPILO-ID or Patient ID
- `given` - Given name
- `family` - Family name
- `birthDate` - Date of birth (YYYY-MM-DD)
- `gender` - Gender

**Examples**:
```bash
# Combined search
curl "http://localhost:3001/api/patients/search?identifier=00-0A-34-2025-N-01036&family=Kasaira"

# Just name
curl "http://localhost:3001/api/patients/search?given=Tawanda"

# Any combination
curl "http://localhost:3001/api/patients/search?family=Doe&birthDate=1990-01-01&gender=male"
```

---

## Response Fields

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Search parameters used |
| `found` | boolean | Whether any matches were found |
| `count` | number | Number of matching patients |
| `confidence` | string | Match confidence: "high", "medium", "low" |
| `duplicateRisk` | string | Duplicate risk: "none", "low", "medium", "high" |
| `patients` | array | Array of matching patients |
| `message` | string | Optional guidance message |

### Patient Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | FHIR Patient resource ID |
| `identifiers.neotreeId` | string | NEOTREE-IMPILO-ID |
| `identifiers.patientId` | string | Patient ID (urn:impilo:uid) |
| `name.given` | string | First given name |
| `name.family` | string | Family name |
| `gender` | string | Gender |
| `birthDate` | string | Date of birth (YYYY-MM-DD) |
| `facility` | string | Facility/Organization ID |
| `source` | string | Source system identifier |

---

## Duplicate Risk Assessment

### Risk Levels

| Risk | Criteria | Recommendation |
|------|----------|----------------|
| **none** | No matches found | Safe to create new patient |
| **low** | 1 weak match | Review match, likely safe to create |
| **medium** | 1-2 demographic matches | Review carefully before creating |
| **high** | Identifier match or 3+ matches | Do NOT create - use existing patient |

### Risk Calculation Logic

**By Identifier**:
- Any match → `high` risk (exact ID match)

**By Demographics**:
- 3+ matches → `high` risk
- 2 matches → `medium` risk
- 1 match → `medium` risk
- 0 matches → `none`

**By Fuzzy Search**:
- 4+ matches → `high` risk
- 2-3 matches → `medium` risk
- 1 match → `low` risk
- 0 matches → `none`

---

## Confidence Levels

| Confidence | Meaning |
|------------|---------|
| **high** | Exact identifier match OR single demographic match |
| **medium** | Multiple matches OR fuzzy/partial match |
| **low** | No matches found |

---

## Usage Examples

### Scenario 1: Pre-Registration Check

Before creating a new patient, check if they already exist:

```javascript
// Step 1: Search by NEOTREE-ID if available
const response1 = await fetch(
  'http://localhost:3001/api/patients/search/by-identifier?identifier=00-0A-34-2025-N-01036'
);
const result1 = await response1.json();

if (result1.duplicateRisk === 'high') {
  console.log('Patient exists! Use existing ID:', result1.patients[0].id);
  return; // Don't create
}

// Step 2: If no ID, search by demographics
const response2 = await fetch(
  'http://localhost:3001/api/patients/search/by-demographics?given=John&family=Doe&birthDate=1990-01-01'
);
const result2 = await response2.json();

if (result2.found) {
  console.log('Potential duplicates found:', result2.count);
  // Show matches to user for review
} else {
  console.log('No duplicates. Safe to create new patient.');
  // Proceed with registration
}
```

### Scenario 2: Fuzzy Matching for Data Entry Errors

```bash
# User typed "Jon Smyth" but actual patient is "John Smith"
curl "http://localhost:3001/api/patients/search/fuzzy?given=Jon&family=Smyth&birthDate=1990-01-01"

# Returns patients with similar names
# duplicateRisk: "medium" - review before creating
```

### Scenario 3: Find All Patients from a Facility

```bash
# Search is currently by patient attributes, not facility filter
# For facility-specific searches, use flexible search with known patient data
curl "http://localhost:3001/api/patients/search?family=CommonName"
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Missing or invalid 'identifier' query parameter"
}
```

### 500 Internal Server Error
```json
{
  "error": "Search failed",
  "message": "Connection timeout"
}
```

---

## Integration with Patient Registration

### Recommended Workflow

```
1. User enters patient data in form
2. Call search API with available data
   ├─ If identifier known → /search/by-identifier
   └─ If no identifier → /search/by-demographics

3. Evaluate response:
   ├─ duplicateRisk: "high" → BLOCK creation, use existing patient
   ├─ duplicateRisk: "medium" → WARN user, show matches for review
   ├─ duplicateRisk: "low" → SUGGEST review, but allow creation
   └─ duplicateRisk: "none" → PROCEED with creation

4. If creating new patient:
   - Generate NEOTREE-IMPILO-ID
   - Insert into MySQL
   - Bridge will push to OpenCR automatically
```

---

## Performance Notes

- Searches are synchronous (wait for OpenCR response)
- Typical response time: 100-500ms
- Retries on failure: 3 attempts with exponential backoff
- Searches go through OpenHIM (authenticated and logged)
- All transactions visible in OpenHIM Console

---

## Authentication

Searches use the same OpenHIM credentials as the push pipeline:
- Username: Configured in `OPENHIM_USERNAME`
- Password: Configured in `OPENHIM_PASSWORD`
- Client ID: Configured in `FACILITY_ID` or `OPENHIM_CLIENT_ID`

No additional authentication required for the search API endpoints.

---

## Testing

### Test All Endpoints

```bash
# 1. Identifier search
curl "http://localhost:3001/api/patients/search/by-identifier?identifier=00-0A-34-2025-N-01036"

# 2. Demographics search
curl "http://localhost:3001/api/patients/search/by-demographics?given=John&family=Doe&birthDate=1990-01-01&gender=male"

# 3. Fuzzy search
curl "http://localhost:3001/api/patients/search/fuzzy?given=Jon&family=Smyth&birthDate=1990-01-01"

# 4. Flexible search
curl "http://localhost:3001/api/patients/search?family=Doe&birthDate=1990-01-01"
```

### Expected Behaviors

- ✅ Identifier match → `duplicateRisk: "high"`, `confidence: "high"`
- ✅ Single demographic match → `duplicateRisk: "medium"`, `confidence: "high"`
- ✅ Multiple matches → `duplicateRisk: "high"`, `confidence: "medium"`
- ✅ No matches → `duplicateRisk: "none"`, message suggests safe to create
- ✅ All searches visible in OpenHIM transaction logs

---

## Troubleshooting

### No Results Returned

```bash
# Check OpenHIM connection
curl -u 'username:password' http://openhim-host:5001/CR/fhir/Patient?identifier=XXX

# Check bridge logs
tail -f /tmp/bridge.log

# Verify OpenHIM credentials in .env
cat .env | grep OPENHIM
```

### 401/403 Errors

- Verify `OPENHIM_USERNAME` and `OPENHIM_PASSWORD` in `.env`
- Check OpenHIM channel allows your client ID
- Ensure channel path is exactly `/CR/fhir`

### Empty Patient Data

- OpenCR may return patients but with missing fields
- Check OpenCR/HAPI FHIR directly to verify data exists

---

## Related Documentation

- [README.md](README.md) - Main documentation
- [SYSTEM_WALKTHROUGH.md](SYSTEM_WALKTHROUGH.md) - Technical deep dive
- [MATCHING_TEST_GUIDE.md](MATCHING_TEST_GUIDE.md) - OpenCR matching algorithms

