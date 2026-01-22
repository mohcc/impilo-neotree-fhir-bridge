-- Check if person_demographic table has address columns
-- Run this query to see what address-related columns exist

SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'report'
  AND TABLE_NAME = 'person_demographic'
  AND (
    COLUMN_NAME LIKE '%address%' OR
    COLUMN_NAME LIKE '%city%' OR
    COLUMN_NAME LIKE '%district%' OR
    COLUMN_NAME LIKE '%province%' OR
    COLUMN_NAME LIKE '%state%' OR
    COLUMN_NAME LIKE '%postal%' OR
    COLUMN_NAME LIKE '%zip%' OR
    COLUMN_NAME LIKE '%country%' OR
    COLUMN_NAME LIKE '%location%' OR
    COLUMN_NAME LIKE '%village%' OR
    COLUMN_NAME LIKE '%ward%'
  )
ORDER BY COLUMN_NAME;

-- Also show all columns in person_demographic for reference
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'report'
  AND TABLE_NAME = 'person_demographic'
ORDER BY ORDINAL_POSITION;
