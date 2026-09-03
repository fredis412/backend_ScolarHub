require('dotenv').config({ path: '.env' });
const pool = require('./src/config/db');

async function check() {
  const users = await pool.query("SELECT id, nom, prenoms, matricule, tel, email, role, mot_de_passe FROM users WHERE LOWER(nom) LIKE '%lankoande%' OR LOWER(prenoms) LIKE '%pascal%'");
  console.log('=== USERS ===');
  console.log(JSON.stringify(users.rows, null, 2));

  const etus = await pool.query("SELECT id, matricule, nom, prenoms, filiere_nom, niveau, nom_parent, tel_parent FROM etudiants WHERE LOWER(nom) LIKE '%lankoande%' OR LOWER(prenoms) LIKE '%pascal%' OR matricule LIKE '%1948%' OR LOWER(nom_parent) LIKE '%lankoande%'");
  console.log('=== ETUDIANTS ===');
  console.log(JSON.stringify(etus.rows, null, 2));

  try {
    const parents = await pool.query("SELECT * FROM parents");
    console.log('=== PARENTS ===');
    console.log(JSON.stringify(parents.rows, null, 2));
  } catch (e) {
    console.log('PARENTS query error:', e.message);
  }

  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
