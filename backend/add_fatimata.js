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
    const checkRes = await client.query("SELECT id FROM users WHERE matricule = '24IST-O2/1234'");
    if (checkRes.rows.length > 0) {
      console.log('Fatimata already exists.');
      return;
    }
    
    await client.query(`
      INSERT INTO users (id, matricule, nom, prenoms, role, domaine, filiere_id, mot_de_passe, statut) 
      VALUES (gen_random_uuid(), '24IST-O2/1234', 'TRAORÉ', 'Fatimata', 'etudiant', 'Sciences & Technologies', '28313c8b-efc9-48f6-8e75-4b3abca740b9', NULL, 'actif')
    `);
    console.log('Fatimata TRAORÉ inserted successfully.');
  } catch (errQuery) {
    console.error('Error running query:', errQuery);
  } finally {
    release();
    pool.end();
  }
});
