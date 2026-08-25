const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false },
});

const migrations = [
  {
    label: 'Table evenements',
    sql: `
      CREATE TABLE IF NOT EXISTS evenements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        titre VARCHAR(255) NOT NULL,
        description TEXT,
        lieu VARCHAR(255),
        date_debut TIMESTAMP NOT NULL,
        prix NUMERIC(12,2) DEFAULT 0,
        capacite INTEGER DEFAULT 0,
        affiche_url TEXT,
        statut VARCHAR(50) DEFAULT 'en_attente',
        auteur UUID REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
  },
  {
    label: 'Table evenement_inscriptions (fiche d\'inscription)',
    sql: `
      CREATE TABLE IF NOT EXISTS evenement_inscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        evenement_id UUID NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        nom VARCHAR(255) NOT NULL,
        prenoms VARCHAR(255),
        email VARCHAR(255),
        telephone VARCHAR(50),
        matricule VARCHAR(100),
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (evenement_id, user_id)
      )
    `,
  },
  {
    label: 'Colonne categorie sur annonces',
    sql: `ALTER TABLE annonces ADD COLUMN IF NOT EXISTS categorie VARCHAR(50)`,
  },
  {
    label: 'Reload du cache de schema PostgREST (Supabase)',
    sql: `NOTIFY pgrst, 'reload schema'`,
  },
];

(async () => {
  try {
    for (const m of migrations) {
      await pool.query(m.sql);
      console.log('OK —', m.label);
    }
    console.log('Migration evenements terminee.');
  } catch (err) {
    console.error('Erreur migration :', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
