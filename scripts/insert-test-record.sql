-- Insert a test record with correct local timezone (CAT = UTC+2)
-- This ensures the timestamp matches your local system time

SET time_zone = '+02:00';  -- Set to CAT (Central Africa Time)
-- Or use your specific timezone offset

INSERT INTO consultation.neonatal_care (
    neonatal_care_id, 
    patient_id, 
    date_time_admission
) 
VALUES (
    uuid(), 
    (SELECT patient_id FROM consultation.patient ORDER BY RAND() LIMIT 1), 
    NOW()  -- This will now use CAT timezone
);

-- Alternative: Use UTC_TIMESTAMP() and convert to local time
-- INSERT INTO consultation.neonatal_care (neonatal_care_id, patient_id, date_time_admission)
-- VALUES (uuid(), (SELECT patient_id FROM consultation.patient ORDER BY RAND() LIMIT 1), CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+02:00'));

