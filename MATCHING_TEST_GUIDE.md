# OpenCR Matching Algorithm - Testing Guide

## ✅ Implementation Status

All requirements are **IMPLEMENTED**:

### 1. Primary Matching Criteria (Patient Identifiable Information)
**Status**: ✅ Implemented in `config/decisionRules.neotree.json`

**Fields Used**:
- **NEOTREE-IMPILO-ID** (`urn:neotree:impilo-id`) - Weight: 10 (highest priority)
- **Patient ID** (`urn:impilo:uid`) - Weight: 8
- **Birth Date** - Weight: 7
- **Family Name** (lastname) - Weight: 6
- **Given Name** (firstname) - Weight: 5
- **Gender** - Weight: 3

### 2. Weighted Scoring Algorithms
**Status**: ✅ Implemented with two matching rules

**Rule 1: Deterministic (Exact Match)**
- Uses exact matching for all fields
- Total possible score: 10 + 8 + 7 + 6 + 5 + 3 = 39
- Auto-match threshold: ≥ 8 points
- Manual review threshold: 5-7 points
- No match: < 5 points

**Rule 2: Probabilistic (Fuzzy Match)**
- Family name: Jaro-Winkler (threshold 0.85)
- Given name: Levenshtein distance (max 2 edits)
- Birth date: Exact match
- Gender: Exact match
- Same scoring thresholds as Rule 1

### 3. Confidence Thresholds
**Status**: ✅ Implemented in decision rules

| Score Range | Action | Confidence Level |
|-------------|--------|------------------|
| ≥ 8 | **Auto-link** | High confidence |
| 5-7 | **Manual Review** | Medium confidence |
| < 5 | **No Match** | Low confidence (create new) |

### 4. Missing/Incomplete Data Handling
**Status**: ✅ Implemented with null_handling strategies

**Null Handling Levels**:
- **Conservative**: Field must be present for matching (used for IDs, birthDate)
- **Moderate**: Missing field reduces score but doesn't fail match (names)
- **Greedy**: Missing field is permissive (gender)

---

## 🧪 How to Test

### Test 1: Exact Match (Auto-Link)
**Scenario**: Send duplicate patient with identical data

```bash
# 1. Send first patient
docker exec mysql mysql -u root -D consultation << 'SQL'
INSERT INTO neonatal_care (neonatal_care_id, patient_id, neotree_id, date_time_admission)
VALUES (UUID(), 'TEST-PAT-001', '00-0A-34-2025-N-99999', NOW());
SQL

# 2. Wait for processing (check logs)
tail -f /tmp/bridge.log

# 3. Send duplicate (same neotree_id)
docker exec mysql mysql -u root -D consultation << 'SQL'
INSERT INTO neonatal_care (neonatal_care_id, patient_id, neotree_id, date_time_admission)
VALUES (UUID(), 'TEST-PAT-001', '00-0A-34-2025-N-99999', NOW() + INTERVAL 1 DAY);
SQL

# 4. Expected: OpenCR should auto-link (score = 10, exact ID match)
```

### Test 2: Fuzzy Name Match
**Scenario**: Test name variations (typos)

```bash
# Create test patients with similar names
# Patient 1: John Smith, DOB: 1990-01-01
# Patient 2: Jon Smyth, DOB: 1990-01-01

# Expected: Score ≥ 8 (auto-link) due to:
# - birthDate match (7 points)
# - Fuzzy family name (Jaro-Winkler > 0.85, 6 points)
# - Fuzzy given name (Levenshtein ≤ 2, 5 points)
# Total: 18 points → Auto-link
```

### Test 3: Manual Review Threshold
**Scenario**: Partial match requiring human review

```bash
# Patient 1: Mary Johnson, DOB: 1985-05-15
# Patient 2: Mary Johnson, DOB: 1985-05-20 (different DOB)

# Expected: Score = 5-7 (manual review) due to:
# - Family match (6 points)
# - Given match (5 points)
# - NO birthDate match (0 points)
# Total: 11 points → Manual Review in OpenCR CRUX
```

### Test 4: Missing Data Handling
**Scenario**: Patient with missing names

```bash
# Patient with only ID and birthdate
# Expected: Conservative fields (ID, DOB) still match
# Moderate fields (names) reduce score but don't fail
```

---

## 📊 Verification in OpenCR CRUX

### 1. Check Auto-Linked Patients
```bash
# Navigate to: http://localhost:9000
# OpenCR CRUX → Client Registry → View Patients
# Look for:
# - "Golden Record" badge (auto-linked patients)
# - Match score displayed
```

### 2. Check Manual Review Queue
```bash
# OpenCR CRUX → Potential Matches
# Review patients flagged for manual review
# Accept or reject matches based on clinical judgment
```

### 3. Verify Matching Logs
```bash
# OpenCR logs show matching decisions
docker logs opencr --tail 50 | grep -i "match\|score"
```

---

## 🔧 Configuration Files

### Decision Rules Location
```
config/decisionRules.neotree.json
```

### Key Parameters to Tune

1. **Weights** (lines 27, 36, 44, 54, 63, 73):
   - Adjust importance of each field
   - Higher weight = more influence on match score

2. **Thresholds** (lines 79-80):
   ```json
   "autoMatchThreshold": 8,      // Auto-link if score ≥ 8
   "potentialMatchThreshold": 5  // Manual review if 5-7
   ```

3. **Null Handling** (per field):
   - `"conservative"` - Strict (both must be present)
   - `"moderate"` - Balanced
   - `"greedy"` - Lenient (allows missing)

4. **Fuzzy Match Thresholds**:
   - Jaro-Winkler: `0.85` (line 89) - 85% similarity required
   - Levenshtein: `2` (line 99) - Max 2 character differences

---

## 🎯 Expected Outcomes

### High Confidence (Auto-Link)
- **Exact ID match** → Score: 10 → Auto-link
- **ID + DOB + Name match** → Score: 10+7+11 = 28 → Auto-link
- **Fuzzy name + DOB + gender** → Score: 11+7+3 = 21 → Auto-link

### Medium Confidence (Manual Review)
- **Name match only** → Score: 11 → Manual review
- **DOB + gender, no names** → Score: 10 → Manual review

### Low Confidence (New Record)
- **No matching fields** → Score: 0 → Create new patient
- **Only gender match** → Score: 3 → Create new patient

---

## 🐛 Troubleshooting

### Matches Not Working
1. Check OpenCR decision rules are loaded:
   ```bash
   docker exec opencr ls -la /src/server/decisionRules/
   ```

2. Verify Elasticsearch index:
   ```bash
   docker exec opencr-es curl 'http://localhost:9200/patients/_search?pretty'
   ```

3. Check OpenCR matching logs:
   ```bash
   docker logs opencr | grep -i "matching\|score"
   ```

### Adjust Sensitivity
- **Too many false positives** → Increase thresholds
- **Too many false negatives** → Decrease thresholds or adjust weights

---

## 📝 Test Checklist

- [ ] Exact ID match (auto-link)
- [ ] Fuzzy name match (auto-link)
- [ ] Partial match (manual review)
- [ ] Missing name fields (still matches on ID)
- [ ] Missing DOB (reduces score appropriately)
- [ ] Gender mismatch (still matches if other fields strong)
- [ ] No matching fields (creates new record)
- [ ] Verify in OpenCR CRUX UI
- [ ] Check audit logs for match decisions

---

## 🔗 Related Documentation
- FHIR Path Syntax: https://www.hl7.org/fhir/fhirpath.html
- OpenCR Documentation: https://github.com/intrahealth/client-registry
- Decision Rules Schema: See `config/decisionRules.neotree.json`
