const { Pool } = require('pg');
require('dotenv').config();
const { ensureFilieres } = require('./src/utils/filieres');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false },
});

const columnMigrations = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS filiere_nom VARCHAR(255)`,
  `ALTER TABLE modules ADD COLUMN IF NOT EXISTS filiere_nom VARCHAR(255)`,
  `ALTER TABLE annonces ADD COLUMN IF NOT EXISTS filiere_nom VARCHAR(255)`,
  `ALTER TABLE edt ADD COLUMN IF NOT EXISTS filiere_nom VARCHAR(255)`,
];

const backfills = [
  {
    label: 'users (étudiants)',
    sql: `
      UPDATE users u
      SET filiere_nom = COALESCE(e.filiere_nom, f.nom)
      FROM etudiants e
      LEFT JOIN filieres f ON f.id = e.filiere_id
      WHERE u.id = e.user_id
        AND u.role = 'etudiant'
        AND (u.filiere_nom IS NULL OR u.filiere_nom = '')
    `,
  },
  {
    label: 'etudiants',
    sql: `
      UPDATE etudiants e
      SET filiere_nom = f.nom
      FROM filieres f
      WHERE f.id = e.filiere_id
        AND (e.filiere_nom IS NULL OR e.filiere_nom = '')
    `,
  },
  {
    label: 'modules',
    sql: `
      UPDATE modules m
      SET filiere_nom = f.nom
      FROM filieres f
      WHERE f.id = m.filiere_id
        AND (m.filiere_nom IS NULL OR m.filiere_nom = '')
    `,
  },
  {
    label: 'annonces',
    sql: `
      UPDATE annonces a
      SET filiere_nom = f.nom
      FROM filieres f
      WHERE f.id = a.filiere
        AND (a.filiere_nom IS NULL OR a.filiere_nom = '')
    `,
  },
  {
    label: 'edt',
    sql: `
      UPDATE edt e
      SET filiere_nom = f.nom
      FROM filieres f
      WHERE f.id = e.filiere
        AND (e.filiere_nom IS NULL OR e.filiere_nom = '')
    `,
  },
];

async function main() {
  const client = await pool.connect();
  try {
    console.log('─── Insertion des filières ───');
    await ensureFilieres(client);
    const list = await client.query('SELECT id, nom FROM filieres ORDER BY nom');
    console.log('Filières en base:', list.rows.length);
    list.rows.forEach((f) => console.log(`  [${f.id}] ${f.nom}`));

    console.log('\n─── Colonnes filiere_nom ───');
    for (const sql of columnMigrations) {
      try {
        await client.query(sql);
        console.log('OK:', sql.slice(0, 55) + '...');
      } catch (err) {
        console.log('SKIP:', err.message);
      }
    }

    console.log('\n─── Backfill noms de filières ───');
    for (const { label, sql } of backfills) {
      try {
        const r = await client.query(sql);
        console.log(`${label}: ${r.rowCount} ligne(s) mise(s) à jour`);
      } catch (err) {
        console.log(`${label}: SKIP — ${err.message}`);
      }
    }

    console.log('\nMigration filières terminée.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
