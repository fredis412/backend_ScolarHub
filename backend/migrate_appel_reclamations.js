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
ALTER TABLE sessions_notes ADD COLUMN IF NOT EXISTS motif_rejet TEXT;

CREATE TABLE IF NOT EXISTS appels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filiere_id INTEGER REFERENCES filieres(id) ON DELETE CASCADE,
    filiere_nom VARCHAR(255),
    niveau VARCHAR(50),
    module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
    professeur_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date_appel DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appel_presences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appel_id UUID REFERENCES appels(id) ON DELETE CASCADE,
    etudiant_id INTEGER REFERENCES etudiants(id) ON DELETE CASCADE,
    matricule VARCHAR(50),
    nom VARCHAR(255),
    prenoms VARCHAR(255),
    statut VARCHAR(20) DEFAULT 'present'
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
    console.log('Tables appels/appel_presences prêtes, colonne motif_rejet ajoutée.');
  } catch (errQuery) {
    console.error('Error running query:', errQuery);
  } finally {
    release();
    pool.end();
  }
});
