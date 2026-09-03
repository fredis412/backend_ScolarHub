require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const cols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'parents' ORDER BY ordinal_position"
  );
  console.log('=== TABLE parents COLUMNS ===');
  console.log(JSON.stringify(cols.rows, null, 2));
  try {
    const sample = await pool.query('SELECT * FROM parents LIMIT 2');
    console.log('\n=== SAMPLE DATA ===');
    console.log(JSON.stringify(sample.rows, null, 2));
  } catch(e) {
    console.error('Sample query error:', e.message);
  }
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
