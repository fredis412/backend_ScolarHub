// ============================================================
// migrate_disponibilites.js — Table des heures libres des profs
// Usage : node migrate_disponibilites.js
// ============================================================

const pool = require('./src/config/db');

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS disponibilites_professeur (
        id SERIAL PRIMARY KEY,
        professeur_id INTEGER REFERENCES professeurs(id) ON DELETE CASCADE,
        jour VARCHAR(10) NOT NULL,
        debut VARCHAR(5) NOT NULL,
        fin VARCHAR(5) NOT NULL,
        transmis_le TIMESTAMP DEFAULT NOW(),
        UNIQUE (professeur_id, jour, debut)
      )
    `);
    console.log('Table disponibilites_professeur prête.');
    process.exit(0);
  } catch (err) {
    console.error('Erreur migration :', err.message);
    process.exit(1);
  }
})();
