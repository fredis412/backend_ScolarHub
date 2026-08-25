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

const query = `
CREATE TABLE IF NOT EXISTS evaluations_professeurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etudiant_id UUID REFERENCES users(id) ON DELETE CASCADE,
    professeur_id UUID REFERENCES users(id) ON DELETE CASCADE,
    note INTEGER CHECK (note >= 1 AND note <= 5),
    commentaire TEXT,
    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (etudiant_id, professeur_id)
);
`;

pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Error connecting:', err.stack);
    process.exit(1);
  }
  try {
    console.log('Connected to database!');
    await client.query(query);
    console.log('Table evaluations_professeurs created successfully.');
  } catch (errQuery) {
    console.error('Error running query:', errQuery);
  } finally {
    release();
    pool.end();
  }
});
