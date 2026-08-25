// ============================================================
// seed_canaux.js — Crée les 3 canaux publics utilisés par l'app
// (ids 1, 2, 3 attendus par canal_screen.dart)
// Usage : node seed_canaux.js
// ============================================================

const pool = require('./src/config/db');

const CANAUX = [
  { id: 1, nom: 'Administration',        description: 'Annonces officielles de l\'administration', type: 'administration' },
  { id: 2, nom: 'Admin & Filière',       description: 'Échanges entre l\'administration et les délégués de filière', type: 'admin_filiere' },
  { id: 3, nom: 'Bureau des Étudiants',  description: 'Annonces et activités du BDE', type: 'bde' },
];

(async () => {
  try {
    for (const c of CANAUX) {
      const { rowCount } = await pool.query(
        `INSERT INTO canaux (id, nom, description, type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.nom, c.description, c.type]
      );
      console.log(rowCount ? `Canal ${c.id} « ${c.nom} » créé.` : `Canal ${c.id} « ${c.nom} » existe déjà.`);
    }
    // Réaligner la séquence après insertion d'ids explicites
    await pool.query(`SELECT setval(pg_get_serial_sequence('canaux', 'id'), (SELECT MAX(id) FROM canaux))`);
    console.log('Terminé.');
    process.exit(0);
  } catch (err) {
    console.error('Erreur seed canaux :', err.message);
    process.exit(1);
  }
})();
