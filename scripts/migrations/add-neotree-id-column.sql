-- Migration: Add neotree_id column to consultation.neonatal_care table
-- Format: PP-DD-SS-YYYY-P-XXXXX (e.g., 00-0A-34-2025-N-01031)
-- This is a unique identifier for Neotree patients

USE consultation;

-- Check if column exists before adding
SET @column_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'consultation' 
      AND TABLE_NAME = 'neonatal_care' 
      AND COLUMN_NAME = 'neotree_id'
);

-- Add neotree_id column if it doesn't exist
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `consultation`.`neonatal_care`
     ADD COLUMN `neotree_id` VARCHAR(25) NULL COMMENT ''NEOTREE-IMPILO-ID format: PP-DD-SS-YYYY-P-XXXXX'' AFTER `patient_id`',
    'SELECT ''Column neotree_id already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check if unique index exists before creating
SET @index_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'consultation' 
      AND TABLE_NAME = 'neonatal_care' 
      AND INDEX_NAME = 'idx_neotree_id_unique'
);

-- Add unique index to ensure uniqueness
-- Note: MySQL allows multiple NULLs in unique index, so this is safe
SET @sql = IF(@index_exists = 0,
    'CREATE UNIQUE INDEX `idx_neotree_id_unique` ON `consultation`.`neonatal_care` (`neotree_id`)',
    'SELECT ''Unique index idx_neotree_id_unique already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check if regular index exists before creating
SET @index_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'consultation' 
      AND TABLE_NAME = 'neonatal_care' 
      AND INDEX_NAME = 'idx_neotree_id'
);

-- Add index for faster searching
SET @sql = IF(@index_exists = 0,
    'CREATE INDEX `idx_neotree_id` ON `consultation`.`neonatal_care` (`neotree_id`)',
    'SELECT ''Index idx_neotree_id already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify the column was added
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'consultation'
  AND TABLE_NAME = 'neonatal_care'
  AND COLUMN_NAME = 'neotree_id';

