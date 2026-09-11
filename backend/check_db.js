const pool = require('./src/config/db');

async function check() {
  try {
    const { rows: canaux } = await pool.query('SELECT id, nom, type, description FROM canaux ORDER BY id ASC');
    console.log('--- CANAUX EN BASE DE DONNÉES ---');
    console.table(canaux);

    const { rows: filieres } = await pool.query('SELECT id, nom, code FROM filieres ORDER BY id ASC');
    console.log('--- FILIÈRES ---');
    console.table(filieres);

    const { rows: profs } = await pool.query(`
      SELECT p.id, u.nom, u.prenoms, u.role, p.specialite 
      FROM professeurs p 
      JOIN users u ON u.id = p.user_id
    `);
    console.log('--- PROFESSEURS ---');
    console.table(profs);

    const { rows: countMembers } = await pool.query(`
      SELECT c.id, c.nom, c.type, count(cm.user_id) as total_membres
      FROM canaux c
      LEFT JOIN canal_membres cm ON cm.canal_id = c.id
      GROUP BY c.id, c.nom, c.type
      ORDER BY c.id ASC
    `);
    console.log('--- MEMBRES PAR CANAL ---');
    console.table(countMembers);

    process.exit(0);
  } catch (err) {
    console.error('Erreur:', err);
    process.exit(1);
  }
}

check();
