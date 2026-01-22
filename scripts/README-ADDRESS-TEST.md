# Testing Address Fields with OpenCR

## Step 1: Check Database Schema

First, check what address columns exist in your `person_demographic` table:

```bash
mysql -u your_user -p your_database < scripts/check-address-columns.sql
```

Or run the query directly:
```sql
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'report'
  AND TABLE_NAME = 'person_demographic'
  AND (
    COLUMN_NAME LIKE '%address%' OR
    COLUMN_NAME LIKE '%city%' OR
    COLUMN_NAME LIKE '%district%' OR
    COLUMN_NAME LIKE '%province%' OR
    COLUMN_NAME LIKE '%postal%' OR
    COLUMN_NAME LIKE '%country%'
  );
```

## Step 2: Update Database Query (if needed)

If your database uses different column names than expected, update `src/db/mysql.ts`:
- Common variations: `address1`, `address2`, `town` (instead of `city`), `region` (instead of `province`)

## Step 3: Test Address Push to OpenCR

Run the test script to verify OpenCR accepts address fields:

```bash
npx tsx scripts/test-address-push.ts
```

This will:
1. Create a test Patient resource with address fields
2. Send it to OpenCR via OpenHIM
3. Show the response status and body
4. Indicate if address fields are accepted

## Step 4: Verify in Production

Once confirmed, the address fields will automatically be included in Patient resources when:
- The database columns exist
- The columns have data
- Patients are pushed to OpenCR

## Address Field Mapping

The code maps database columns to FHIR address fields:

| Database Column | FHIR Address Field | Notes |
|----------------|-------------------|-------|
| `address` or `address_line1` | `line[0]` | Street address |
| `address_line2` | `line[1]` | Additional address line |
| `city` or `village` | `city` | City/Village name |
| `district` or `ward` | `district` | District/Ward |
| `province` or `state` | `state` | Province/State |
| `postal_code` or `zip_code` | `postalCode` | Postal/ZIP code |
| `country` | `country` | ISO country code (defaults to "ZW" for Zimbabwe) |

## Expected Behavior

- ✅ **If address columns exist and have data**: Address will be included in Patient resource
- ✅ **If address columns don't exist**: Query will still work (NULL values), no address in Patient resource
- ✅ **If address columns exist but are NULL**: No address in Patient resource
- ✅ **Country defaults to "ZW"**: If country is not specified, defaults to Zimbabwe
