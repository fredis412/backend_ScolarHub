// ============================================================
// src/utils/canauxStandard.js
// Canaux « standard » propres à CHAQUE établissement.
//
// Avant : les canaux 1 à 6 étaient globaux (ids fixes) et appartenaient à l'IST.
// Maintenant : chaque établissement possède ses propres canaux standard, retrouvés
// par leur TYPE. L'IST garde ses canaux 1 à 6 existants (rattachés à l'IST par la
// migration de la phase 1) ; une nouvelle école reçoit les siens à la demande
// (ou à sa création, voir ensureCanauxStandard).
// ============================================================

const pool = require('../config/db');

const STANDARD_CANAUX = {
  1: { nom: 'Administration', type: 'administration', description: "Annonces officielles de l'administration" },
  2: { nom: 'Admin & Filière', type: 'admin_filiere', description: "Échanges entre l'administration et les délégués de filière" },
  3: { nom: 'Bureau des Étudiants', type: 'bde', description: 'Annonces et activités du BDE' },
  4: { nom: 'Salle des Professeurs', type: 'professeurs', description: "Canal d'échanges entre professeurs" },
  5: { nom: 'Administration & Professeurs', type: 'admin_profs', description: 'Canal officiel Admin ↔ Tous les professeurs' },
  6: { nom: 'Administration & Délégués', type: 'admin_delegues', description: 'Canal officiel Admin ↔ Délégués de filières' },
};

// Anciens ids fixes (utilisés tels quels par les jetons sans établissement).
const IDS_HISTORIQUES = Object.fromEntries(
  Object.entries(STANDARD_CANAUX).map(([id, c]) => [c.type, String(id)])
);

// Renvoie { administration: '12', bde: '14', … } pour l'établissement ; crée les
// canaux manquants. Sans établissement (ancien jeton) : ids historiques.
async function ensureCanauxStandard(etabId) {
  if (!etabId) return { ...IDS_HISTORIQUES };
  const resultat = {};
  for (const std of Object.values(STANDARD_CANAUX)) {
    const ex = await pool.query(
      'SELECT id FROM canaux WHERE type = $1 AND etablissement_id = $2 ORDER BY id ASC LIMIT 1',
      [std.type, etabId]
    );
    if (ex.rows[0]) {
      resultat[std.type] = String(ex.rows[0].id);
      continue;
    }
    // Les canaux 1 à 6 ont été créés avec des ids explicites : on prend MAX(id)+1
    // plutôt que de compter sur la séquence, qui pourrait être en retard.
    const mx = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM canaux');
    const ins = await pool.query(
      `INSERT INTO canaux (id, nom, description, type, etablissement_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [mx.rows[0].next, std.nom, std.description, std.type, etabId]
    );
    resultat[std.type] = String(ins.rows[0].id);
  }
  return resultat;
}

module.exports = { STANDARD_CANAUX, IDS_HISTORIQUES, ensureCanauxStandard };
