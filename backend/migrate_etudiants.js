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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS domaine VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS niveau VARCHAR(50)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS date_naissance VARCHAR(50)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS nationalite VARCHAR(100) DEFAULT 'Burkinabè'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS adresse TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS nom_parent VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS tel_parent VARCHAR(50)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_parent VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS etudiant_role VARCHAR(50) DEFAULT 'etudiant'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS filiere_role VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS matricule VARCHAR(50)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS nom VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS prenoms VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS tel VARCHAR(50)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS filiere_nom VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS domaine VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS niveau VARCHAR(50)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS date_naissance VARCHAR(50)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS nationalite VARCHAR(100) DEFAULT 'Burkinabè'`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS adresse TEXT`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS nom_parent VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS tel_parent VARCHAR(50)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS email_parent VARCHAR(255)`,
  `ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS statut VARCHAR(50) DEFAULT 'actif'`,
];

const backfill = `
  UPDATE etudiants e
  SET
    matricule = u.matricule,
    nom = u.nom,
    prenoms = u.prenoms,
    email = u.email,
    tel = u.tel,
    domaine = u.domaine,
    niveau = u.niveau,
    date_naissance = u.date_naissance,
    nationalite = u.nationalite,
    adresse = u.adresse,
    nom_parent = u.nom_parent,
    tel_parent = u.tel_parent,
    email_parent = u.email_parent,
    statut = u.statut,
    filiere_nom = (SELECT nom FROM filieres WHERE id = e.filiere_id)
  FROM users u
  WHERE e.user_id = u.id
    AND (e.nom IS NULL OR e.matricule IS NULL)
`;

async function main() {
  const client = await pool.connect();
  try {
    for (const sql of migrations) {
      await client.query(sql);
      console.log('OK:', sql.slice(0, 60) + '...');
    }
    const backfillRes = await client.query(backfill);
    console.log('Backfill etudiants:', backfillRes.rowCount, 'ligne(s) mise(s) à jour.');
    console.log('Migration terminée.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
