// ============================================================
// src/controllers/canauxNonLus.controller.js
// Compteurs de messages non lus par canal (page « Canaux » de l'étudiant)
//
//  GET  /api/messages/canaux/non-lus   → { data: { "<canalId>": n, ... }, total }
//  POST /api/messages/canaux/:id/lu    → marque le canal comme lu (compteur à 0)
//
// Principe : une ligne (user_id, canal_id, dernier_lu) par utilisateur et par
// canal. Non lu = message d'un AUTRE auteur, plus récent que « dernier_lu ».
// Au tout premier appel, « dernier_lu » est initialisé à maintenant : les
// anciens messages ne comptent pas, seuls les nouveaux s'ajoutent.
// ============================================================

const pool = require('../config/db');
const { normalizeNiveau } = require('../utils/filieres');

const ROLES_STAFF = ['admin', 'professeur', 'prof', 'enseignant', 'teacher'];

// Filière + niveau de l'étudiant, gardés 5 min (évite une requête à chaque appel).
const _profilCache = new Map(); // userId -> { filiereId, niveau, exp }
async function profilEtudiant(userId) {
  const enCache = _profilCache.get(userId);
  if (enCache && enCache.exp > Date.now()) return enCache;
  const r = await pool.query(
    `SELECT filiere_id, niveau FROM etudiants WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  const p = {
    filiereId: r.rows[0]?.filiere_id ?? null,
    niveau: r.rows[0]?.niveau ? normalizeNiveau(r.rows[0].niveau) : null,
    exp: Date.now() + 5 * 60 * 1000,
  };
  _profilCache.set(userId, p);
  return p;
}

// Canaux visibles : Administration, BDE, canal « Admin & Filière » de SA
// filière + niveau, et tout canal dont il est membre explicite (coordination
// pédagogique des délégués…). Les professeurs ajoutent leurs canaux de salle.
const CANAUX_VISIBLES = `
  ($2::int IS NULL OR c.etablissement_id = $2::int)
  AND (
    c.type IN ('administration', 'bde')
    OR EXISTS (SELECT 1 FROM canal_membres cm WHERE cm.canal_id = c.id AND cm.user_id = $1::uuid)
    OR (c.type = 'admin_filiere_niveau' AND EXISTS (
          SELECT 1 FROM etudiants e
          WHERE e.user_id = $1::uuid AND e.filiere_id = c.filiere_id AND e.niveau = c.niveau))
    OR ($3::text = 'true' AND c.type IN ('professeurs', 'admin_profs'))
  )`;

// 1) Initialisation : un canal jamais consulté démarre à « maintenant »
//    (les anciens messages ne comptent pas). Requête d'écriture séparée :
//    la couche base de données refuse une écriture dans un WITH.
const SQL_INIT = `
INSERT INTO canal_lectures (user_id, canal_id, dernier_lu)
SELECT $1::uuid, c.id, now() FROM canaux c
WHERE ${CANAUX_VISIBLES}
ON CONFLICT (user_id, canal_id) DO NOTHING
`;

// 2) Comptage (lecture seule). Les annonces publiées (table annonces)
//    comptent pour le canal Administration, comme dans getMessagesCanal.
const SQL_NON_LUS = `
WITH acc AS (
  SELECT c.id, c.type FROM canaux c WHERE ${CANAUX_VISIBLES}
)
SELECT m.canal_id::text AS canal_id, COUNT(*)::int AS n
FROM acc
JOIN canal_lectures cl ON cl.canal_id = acc.id AND cl.user_id = $1::uuid
JOIN messages m ON m.canal_id = acc.id
WHERE m.auteur_id <> $1::uuid
  AND COALESCE(m.type, 'canal') <> 'annonce'
  AND m.created_at > cl.dernier_lu
  AND NOT EXISTS (
    SELECT 1 FROM messages_masques mm
    WHERE mm.message_id = m.id AND mm.message_type = 'canal' AND mm.user_id = $1::uuid
  )
GROUP BY m.canal_id
UNION ALL
SELECT acc.id::text AS canal_id, COUNT(*)::int AS n
FROM acc
JOIN canal_lectures cl ON cl.canal_id = acc.id AND cl.user_id = $1::uuid
JOIN annonces a ON a.statut = 'publie'
WHERE acc.type = 'administration'
  AND $3::text <> 'true'
  AND COALESCE(a."createdAt", a."updatedAt") > cl.dernier_lu
  AND LOWER(COALESCE(a."cibleRole", 'tous')) IN ('tous', 'etudiant')
  AND ($2::int IS NULL OR a.etablissement_id = $2::int)
  AND (a.filiere IS NULL OR a.filiere = 0 OR ($4::int IS NOT NULL AND a.filiere = $4::int))
  AND ($5::text IS NULL OR a.niveau IS NULL OR a.niveau = '' OR a.niveau = $5::text)
GROUP BY acc.id
`;

// L'initialisation n'est refaite que toutes les 5 min par utilisateur
// (un nouveau canal rejoint apparaît donc au plus 5 min plus tard).
const _initFaite = new Map(); // userId -> expiration (ms)

const getNonLusCanaux = async (req, res) => {
  try {
    const staff = ROLES_STAFF.includes(String(req.user.role || '').toLowerCase().trim());
    let filiereId = null;
    let niveau = null;
    if (!staff) {
      const p = await profilEtudiant(req.user.id);
      filiereId = p.filiereId;
      niveau = p.niveau;
    }
    const etab = req.etablissementId || null;
    const modeStaff = staff ? 'true' : 'false';
    const exp = _initFaite.get(req.user.id);
    if (!exp || exp < Date.now()) {
      await pool.query(SQL_INIT, [req.user.id, etab, modeStaff]);
      _initFaite.set(req.user.id, Date.now() + 5 * 60 * 1000);
    }
    const { rows } = await pool.query(SQL_NON_LUS, [
      req.user.id,
      etab,
      modeStaff,
      filiereId,
      niveau,
    ]);
    const data = {};
    let total = 0;
    for (const r of rows) {
      const n = parseInt(r.n, 10) || 0;
      data[r.canal_id] = (data[r.canal_id] || 0) + n;
      total += n;
    }
    // Professeurs : messages privés non lus + réclamations à traiter
    // (transmises par l'administration, pas encore renvoyées).
    let prives = 0;
    let reclamations = 0;
    if (staff) {
      try {
      const ex = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM messages_prives mp
             WHERE mp.destinataire_id = $1::uuid AND mp.is_read = FALSE)::int AS prives,
           (SELECT COUNT(*) FROM reclamations r
             WHERE r.prof_id = $1::uuid AND r.etape = 'professeur' AND r.statut = 'en_cours')::int AS reclamations`,
        [req.user.id]
      );
      prives = parseInt(ex.rows[0]?.prives, 10) || 0;
      reclamations = parseInt(ex.rows[0]?.reclamations, 10) || 0;
      } catch (e) { console.warn('[nonLus] compteurs staff:', e.message); }
    }
    // Étudiants : nouveaux supports de cours / nouvel emploi du temps
    // depuis la dernière ouverture de « Cours » / « Planning ».
    let cours = 0;
    let planning = 0;
    let bulletins = 0;
    if (!staff) {
      try {
        await pool.query(
          `INSERT INTO vues_sections (user_id, section, derniere_vue)
           VALUES ($1::uuid,'cours',now()),($1::uuid,'planning',now()),($1::uuid,'bulletins',now())
           ON CONFLICT (user_id, section) DO NOTHING`,
          [req.user.id]
        );
        const nv = await pool.query(
          `SELECT
             (SELECT COUNT(*) FROM notifications n
               WHERE n.user_id = $1::uuid AND n.titre = 'Nouveau support de cours'
                 AND n.created_at > COALESCE((SELECT derniere_vue FROM vues_sections WHERE user_id=$1::uuid AND section='cours'), now()))::int AS cours,
             (SELECT COUNT(*) FROM notifications n
               WHERE n.user_id = $1::uuid AND n.titre = 'Nouvel emploi du temps'
                 AND n.created_at > COALESCE((SELECT derniere_vue FROM vues_sections WHERE user_id=$1::uuid AND section='planning'), now()))::int AS planning,
             (SELECT COUNT(*) FROM notifications n
               WHERE n.user_id = $1::uuid AND n.titre = 'Bulletin publié'
                 AND n.created_at > COALESCE((SELECT derniere_vue FROM vues_sections WHERE user_id=$1::uuid AND section='bulletins'), now()))::int AS bulletins`,
          [req.user.id]
        );
        cours = parseInt(nv.rows[0]?.cours, 10) || 0;
        planning = parseInt(nv.rows[0]?.planning, 10) || 0;
        bulletins = parseInt(nv.rows[0]?.bulletins, 10) || 0;
      } catch (e) { console.warn('[nonLus] nouveautés étudiant:', e.message); }
    }
    res.json({ success: true, data, total, prives, reclamations, cours, planning, bulletins });
  } catch (err) {
    console.error('[getNonLusCanaux]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

const marquerCanalLu = async (req, res) => {
  const canalId = parseInt(req.params.id, 10);
  if (!canalId) return res.status(400).json({ success: false, error: 'Canal invalide' });
  try {
    await pool.query(
      `INSERT INTO canal_lectures (user_id, canal_id, dernier_lu)
       SELECT $1::uuid, c.id, now() FROM canaux c
       WHERE c.id = $2::int AND ($3::int IS NULL OR c.etablissement_id = $3::int)
       ON CONFLICT (user_id, canal_id) DO UPDATE SET dernier_lu = now()`,
      [req.user.id, canalId, req.etablissementId || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[marquerCanalLu]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

const SECTIONS = ['cours', 'planning', 'bulletins'];
const marquerSectionVue = async (req, res) => {
  const section = String(req.params.section || '');
  if (!SECTIONS.includes(section)) return res.status(400).json({ success: false, error: 'Section invalide' });
  try {
    await pool.query(
      `INSERT INTO vues_sections (user_id, section, derniere_vue) VALUES ($1::uuid, $2, now())
       ON CONFLICT (user_id, section) DO UPDATE SET derniere_vue = now()`,
      [req.user.id, section]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[marquerSectionVue]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

module.exports = { getNonLusCanaux, marquerCanalLu, marquerSectionVue };