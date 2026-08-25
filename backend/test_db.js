const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false }
});

pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Error connecting:', err.stack);
    process.exit(1);
  }
  try {
    const res = await client.query("SELECT * FROM users WHERE matricule = '24IST-O2/1851'");
    console.log('User all details:');
    console.log(res.rows[0]);
  } catch (errQuery) {
    console.error('Error running query:', errQuery);
  } finally {
    release();
    pool.end();
  }
});
