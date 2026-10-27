// ============================================================
// src/utils/canauxProfDelegue.js
// Création/récupération du sous-fil de discussion "Professeurs & Délégués"
// pour un (professeur, filière, niveau) donné.
//
// Déclencheur : la première fois qu'un module est affecté à ce professeur
// pour cette filière/niveau (voir professeurs.controller.js#assignerModule).
// Le sous-fil regroupe TOUS les modules de ce prof pour ce niveau — pas un
// sous-fil par module.
//
// Audience : le professeur concerné + le(s) délégué(s)/adjoint(s) de ce
// (filière, niveau) uniquement. Ni les autres profs, ni l'administration,
// ni les autres étudiants n'y ont accès (voir accesCanal dans
// messageController.js, qui applique cette restriction).
// ============================================================

const pool = require('../config/db');
const { envoyerNotificationAuto } = require('../controllers/notifications.controller');

// Multi-établissement : un canal appartient à l'établissement de sa filière.
// On renseigne canaux.etablissement_id à la création — sans cela le canal serait
// refusé à tous par accesCanal (messageController) pour les jetons avec établissement.
async function etablissementDeFiliere(filiereId) {
  const { rows } = await pool.query('SELECT etablissement_id FROM filieres WHERE id = $1', [filiereId]);
  return rows[0]?.etablissement_id || null;
}

// Renvoie les user_id des délégué(e)s et adjoint(e)s d'un (filiere_id, niveau).
async function getDeleguesEtAdjoints(filiereId, niveau) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nom, u.prenoms, u.etudiant_role
     FROM users u
     JOIN etudiants e ON e.user_id = u.id
     WHERE e.filiere_id = $1 AND e.niveau = $2
       AND LOWER(u.etudiant_role) IN ('delegue', 'delegue_adjoint')`,
    [filiereId, niveau]
  );
  return rows;
}

// Trouve ou crée le sous-fil (professeur, filiere, niveau). Si créé pour la
// première fois, ajoute le prof + le(s) délégué(s)/adjoint(s) comme membres
// et notifie ces derniers.
async function getOrCreateCanalProfDelegue(professeurId, filiereId, niveau) {
  const existing = await pool.query(
    `SELECT id FROM canaux WHERE type = 'prof_delegue_niveau'
       AND professeur_id = $1 AND filiere_id = $2 AND niveau = $3`,
    [professeurId, filiereId, niveau]
  );
  if (existing.rows[0]) {
    return { canalId: existing.rows[0].id, cree: false };
  }

  const { rows: profRows } = await pool.query('SELECT nom, prenoms FROM users WHERE id = $1', [professeurId]);
  const prof = profRows[0];
  const { rows: filRows } = await pool.query('SELECT nom FROM filieres WHERE id = $1', [filiereId]);
  const filiereNom = filRows[0]?.nom || '';

  const nomCanal = `${prof ? `${prof.prenoms} ${prof.nom}` : 'Professeur'} · ${filiereNom} ${niveau}`;
  const description = `Coordination pédagogique — ${filiereNom} ${niveau}`;

  const etabId = await etablissementDeFiliere(filiereId);
  const { rows: inserted } = etabId
    ? await pool.query(
        `INSERT INTO canaux (nom, description, type, professeur_id, filiere_id, niveau, etablissement_id)
         VALUES ($1, $2, 'prof_delegue_niveau', $3, $4, $5, $6)
         RETURNING id`,
        [nomCanal, description, professeurId, filiereId, niveau, etabId]
      )
    : await pool.query(
        `INSERT INTO canaux (nom, description, type, professeur_id, filiere_id, niveau)
         VALUES ($1, $2, 'prof_delegue_niveau', $3, $4, $5)
         RETURNING id`,
        [nomCanal, description, professeurId, filiereId, niveau]
      );
  const canalId = inserted[0].id;

  // Ajouter le professeur comme membre.
  await pool.query(
    `INSERT INTO canal_membres (canal_id, user_id, role) VALUES ($1, $2, 'professeur')
     ON CONFLICT (canal_id, user_id) DO NOTHING`,
    [canalId, professeurId]
  );

  // Ajouter délégué(e)s/adjoint(e)s + notifier.
  const delegues = await getDeleguesEtAdjoints(filiereId, niveau);
  for (const d of delegues) {
    await pool.query(
      `INSERT INTO canal_membres (canal_id, user_id, role) VALUES ($1, $2, 'delegue')
       ON CONFLICT (canal_id, user_id) DO NOTHING`,
      [canalId, d.id]
    );
    await envoyerNotificationAuto(
      d.id,
      'Nouvelle discussion avec un professeur',
      `${prof ? `${prof.prenoms} ${prof.nom}` : 'Un professeur'} a rejoint votre canal de coordination pour ${filiereNom} ${niveau}.`
    );
  }

  return { canalId, cree: true };
}

// Trouve ou crée le canal "Admin Filière" pour un (filiere_id, niveau) donné.
// Lecture ouverte à tous les étudiants de ce niveau ; écriture réservée à
// l'admin et au(x) délégué(s)/adjoint(s) de ce niveau (voir peutEcrireCanal
// dans messageController.js).
async function getOrCreateCanalAdminFiliereNiveau(filiereId, niveau) {
  const existing = await pool.query(
    `SELECT id FROM canaux WHERE type = 'admin_filiere_niveau' AND filiere_id = $1 AND niveau = $2`,
    [filiereId, niveau]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const { rows: filRows } = await pool.query('SELECT nom FROM filieres WHERE id = $1', [filiereId]);
  const filiereNom = filRows[0]?.nom || '';

  const etabId = await etablissementDeFiliere(filiereId);
  const { rows: inserted } = etabId
    ? await pool.query(
        `INSERT INTO canaux (nom, description, type, filiere_id, niveau, etablissement_id)
         VALUES ($1, $2, 'admin_filiere_niveau', $3, $4, $5)
         RETURNING id`,
        [`${filiereNom} · ${niveau}`, `Communications administration ↔ ${filiereNom} ${niveau}`, filiereId, niveau, etabId]
      )
    : await pool.query(
        `INSERT INTO canaux (nom, description, type, filiere_id, niveau)
         VALUES ($1, $2, 'admin_filiere_niveau', $3, $4)
         RETURNING id`,
        [`${filiereNom} · ${niveau}`, `Communications administration ↔ ${filiereNom} ${niveau}`, filiereId, niveau]
      );
  return inserted[0].id;
}

// Aligne les membres « délégué » de tous les sous-fils prof↔délégués d'un
// (filière, niveau) sur les délégués/adjoints ACTUELS : ajoute les nouveaux
// (nomination) et retire ceux qui ne le sont plus (révocation).
async function synchroniserDeleguesCanaux(filiereId, niveau) {
  if (!filiereId || !niveau) return;
  const { rows: canaux } = await pool.query(
    `SELECT id FROM canaux WHERE type = 'prof_delegue_niveau' AND filiere_id = $1 AND niveau = $2`,
    [filiereId, niveau]
  );
  if (canaux.length === 0) return;
  const delegues = await getDeleguesEtAdjoints(filiereId, niveau);
  const idsActuels = new Set(delegues.map((d) => String(d.id)));
  for (const canal of canaux) {
    const { rows: membres } = await pool.query(
      `SELECT user_id FROM canal_membres WHERE canal_id = $1 AND role = 'delegue'`,
      [canal.id]
    );
    for (const m of membres) {
      if (!idsActuels.has(String(m.user_id))) {
        await pool.query('DELETE FROM canal_membres WHERE canal_id = $1 AND user_id = $2', [canal.id, m.user_id]);
      }
    }
    for (const d of delegues) {
      await pool.query(
        `INSERT INTO canal_membres (canal_id, user_id, role) VALUES ($1, $2, 'delegue')
         ON CONFLICT (canal_id, user_id) DO NOTHING`,
        [canal.id, d.id]
      );
    }
  }
}

module.exports = { getOrCreateCanalProfDelegue, getDeleguesEtAdjoints, getOrCreateCanalAdminFiliereNiveau, synchroniserDeleguesCanaux };