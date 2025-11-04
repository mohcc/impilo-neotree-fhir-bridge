import mysql from 'mysql2/promise';

async function test() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: '',
    database: 'consultation',
    connectionLimit: 10
  });

  try {
    console.log('=== Testing MySQL Connection ===');
    await pool.query('SELECT 1');
    console.log('✅ Connected\n');

    console.log('=== Testing neonatal_care count ===');
    const [rows1] = await pool.query('SELECT COUNT(*) as count FROM neonatal_care');
    console.log('Count:', rows1[0].count, '\n');

    console.log('=== Testing JOIN query (what the app uses) ===');
    const sql = `
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
      FROM neonatal_care nc
      INNER JOIN patient p ON nc.patient_id = p.patient_id
      INNER JOIN report.person_demographic pd ON p.person_id = pd.person_id
      LIMIT 2
    `;
    const [rows] = await pool.query(sql);
    console.log(`Found ${rows.length} rows`);
    if (rows.length > 0) {
      console.log('\nSample row:');
      console.log(JSON.stringify(rows[0], null, 2));
    } else {
      console.log('\n❌ No rows returned - JOIN is failing!');
      console.log('\nDebugging: Check if patient_ids match...');
      const [nc] = await pool.query('SELECT patient_id FROM neonatal_care LIMIT 1');
      console.log('Sample neonatal_care patient_id:', nc[0].patient_id);
      const [p] = await pool.query('SELECT patient_id FROM patient WHERE patient_id = ?', [nc[0].patient_id]);
      console.log('Matching patient found:', p.length > 0 ? 'YES' : 'NO');
    }
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('Code:', err.code);
  } finally {
    await pool.end();
  }
}

test();
