const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');

const CRITERES = ['pedagogie', 'ponctualite', 'disponibilite', 'clarte'];

// ── Isolation par établissement ─────────────────────────────────────────────
// Une période appartient à l'établissement de sa filière (filieres.etablissement_id).
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
async function periodeDeMonEtab(req, id) {
  if (!req.etablissementId) return true;
  const r = await pool.query(
    `SELECT 1 FROM periodes_evaluation pe JOIN filieres f ON f.id = pe.filiere_id
     WHERE pe.id = $1 AND f.etablissement_id = $2`,
    [id, req.etablissementId]
  );
  return r.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — Gestion des périodes d'évaluation (une par filière)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/evaluations/periodes (admin)
const creerPeriode = async (req, res) => {
  try {
    const { filiere_id, date_debut, date_fin } = req.body;
    if (!filiere_id || !date_debut || !date_fin) {
      return res.status(400).json({ success: false, message: 'filiere_id, date_debut et date_fin sont requis.' });
    }
    const filiereRes = await pool.query(
      `SELECT nom FROM filieres WHERE id = $1${req.etablissementId ? ' AND etablissement_id = $2' : ''}`,
      req.etablissementId ? [filiere_id, req.etablissementId] : [filiere_id]
    );
    if (filiereRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Filière introuvable.' });
    }
    const filiereNom = filiereRes.rows[0].nom;

    const insert = await pool.query(
      `INSERT INTO periodes_evaluation (filiere_id, filiere_nom, date_debut, date_fin, ouverte)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [filiere_id, filiereNom, date_debut, date_fin]
    );
    const periodeId = insert.rows[0].id;

    // Notifier tous les étudiants de la filière — non-bloquant.
    (async () => {
      try {
        const etusRes = await pool.query(
          `SELECT u.id FROM users u
           JOIN etudiants e ON e.user_id = u.id
           WHERE e.filiere_id = $1
             AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%')
             AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye')`,
          [filiere_id]
        );
        for (const e of etusRes.rows) {
          await envoyerNotificationAuto(
            e.id,
            'Évaluez vos professeurs',
            `Une période d'évaluation est ouverte pour ${filiereNom}. Vos réponses sont anonymes.`,
            'evaluation',
            null
          );
        }
      } catch (notifErr) {
        console.error('[creerPeriode] notification', notifErr.message);
      }
    })();

    res.status(201).json({ success: true, message: 'Période ouverte.', id: periodeId });
  } catch (error) {
    console.error('[creerPeriode]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la création de la période.' });
  }
};

// GET /api/evaluations/periodes (admin)
const getPeriodes = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pe.*, COUNT(DISTINCT ep.id) AS nb_reponses
      FROM periodes_evaluation pe
      LEFT JOIN evaluations_professeurs ep ON ep.periode_id = pe.id
      ${req.etablissementId ? 'WHERE pe.filiere_id IN (SELECT id FROM filieres WHERE etablissement_id = $1)' : ''}
      GROUP BY pe.id
      ORDER BY pe.created_at DESC
    `, req.etablissementId ? [req.etablissementId] : []);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[getPeriodes]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des périodes.' });
  }
};

// PATCH /api/evaluations/periodes/:id/cloturer (admin)
const cloturerPeriode = async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await periodeDeMonEtab(req, id))) {
      return res.status(404).json({ success: false, message: 'Période introuvable.' });
    }
    const result = await pool.query(
      `UPDATE periodes_evaluation SET ouverte = false WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Période introuvable.' });
    }
    res.json({ success: true, message: 'Période clôturée.' });
  } catch (error) {
    console.error('[cloturerPeriode]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la clôture.' });
  }
};

// GET /api/evaluations/periodes/:id/resultats (admin)
// ⚠️ Anonymat "d'affichage" : cette requête ne renvoie JAMAIS etudiant_id ni
// aucune information permettant de relier une réponse à un étudiant précis
// — uniquement des moyennes agrégées par professeur, et les commentaires en
// vrac (sans auteur).
const getResultatsPeriode = async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await periodeDeMonEtab(req, id))) {
      return res.status(404).json({ success: false, message: 'Période introuvable.' });
    }
    const result = await pool.query(`
      SELECT
        u.id AS professeur_id, u.nom, u.prenoms,
        COUNT(ep.id) AS nb_reponses,
        AVG((ep.criteres->>'pedagogie')::numeric) AS moy_pedagogie,
        AVG((ep.criteres->>'ponctualite')::numeric) AS moy_ponctualite,
        AVG((ep.criteres->>'disponibilite')::numeric) AS moy_disponibilite,
        AVG((ep.criteres->>'clarte')::numeric) AS moy_clarte,
        AVG(
          ((ep.criteres->>'pedagogie')::numeric +
           (ep.criteres->>'ponctualite')::numeric +
           (ep.criteres->>'disponibilite')::numeric +
           (ep.criteres->>'clarte')::numeric) / 4.0
        ) AS moyenne_globale
      FROM evaluations_professeurs ep
      JOIN users u ON u.id = ep.professeur_id
      WHERE ep.periode_id = $1
      GROUP BY u.id, u.nom, u.prenoms
      ORDER BY moyenne_globale DESC NULLS LAST
    `, [id]);

    const commentairesRes = await pool.query(
      `SELECT professeur_id, commentaire FROM evaluations_professeurs
       WHERE periode_id = $1 AND commentaire IS NOT NULL AND commentaire != ''`,
      [id]
    );
    const commentairesParProf = {};
    for (const row of commentairesRes.rows) {
      commentairesParProf[row.professeur_id] ??= [];
      commentairesParProf[row.professeur_id].push(row.commentaire);
    }

    const data = result.rows.map(r => ({ ...r, commentaires: commentairesParProf[r.professeur_id] || [] }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[getResultatsPeriode]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du calcul des résultats.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ÉTUDIANT
// ════════════════════════════════════════════════════════════════════════════

// GET /api/evaluations/a-faire (étudiant) — période ouverte de sa filière +
// liste des profs (avec statut déjà évalué par LUI, pour son propre suivi —
// ça ne fuite rien à l'admin).
const getEvaluationsAFaire = async (req, res) => {
  try {
    const userId = req.user.id;
    const etuRes = await pool.query('SELECT filiere_id FROM etudiants WHERE user_id = $1', [userId]);
    const etu = etuRes.rows[0];
    if (!etu || !etu.filiere_id) {
      return res.json({ success: true, data: null });
    }

    const periodeRes = await pool.query(
      `SELECT * FROM periodes_evaluation WHERE filiere_id = $1 AND ouverte = true ORDER BY created_at DESC LIMIT 1`,
      [etu.filiere_id]
    );
    const periode = periodeRes.rows[0];
    if (!periode) {
      return res.json({ success: true, data: null });
    }

    const profsRes = await pool.query(`
      SELECT DISTINCT u.id, u.nom, u.prenoms
      FROM module_professeur mp
      JOIN professeurs p ON p.id = mp.professeur_id
      JOIN users u ON u.id = p.user_id
      JOIN modules m ON m.id = mp.module_id
      WHERE m.filiere_id = $1
      ORDER BY u.nom
    `, [etu.filiere_id]);

    const dejaFaitRes = await pool.query(
      `SELECT professeur_id FROM evaluations_professeurs WHERE periode_id = $1 AND etudiant_id = $2`,
      [periode.id, userId]
    );
    const dejaFaitSet = new Set(dejaFaitRes.rows.map(r => r.professeur_id));

    const professeurs = profsRes.rows.map(p => ({
      id: p.id,
      nom: p.nom,
      prenoms: p.prenoms,
      deja_evalue: dejaFaitSet.has(p.id),
    }));

    res.json({
      success: true,
      data: {
        periode_id: periode.id,
        filiere_nom: periode.filiere_nom,
        date_fin: periode.date_fin,
        professeurs,
      },
    });
  } catch (error) {
    console.error('[getEvaluationsAFaire]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement.' });
  }
};

// POST /api/evaluations (étudiant)
const soumettreEvaluation = async (req, res) => {
  try {
    const { periode_id, professeur_id, criteres, commentaire } = req.body;
    const etudiant_id = req.user.id;

    if (!periode_id || !professeur_id || !criteres) {
      return res.status(400).json({ success: false, message: 'periode_id, professeur_id et criteres sont requis.' });
    }
    for (const c of CRITERES) {
      const v = criteres[c];
      if (typeof v !== 'number' || v < 1 || v > 5) {
        return res.status(400).json({ success: false, message: `Le critère "${c}" doit être une note entre 1 et 5.` });
      }
    }

    const periodeRes = await pool.query('SELECT ouverte FROM periodes_evaluation WHERE id = $1', [periode_id]);
    if (periodeRes.rows.length === 0 || !periodeRes.rows[0].ouverte || !(await periodeDeMonEtab(req, periode_id))) {
      return res.status(400).json({ success: false, message: 'Cette période d\'évaluation est fermée.' });
    }

    await pool.query(
      `INSERT INTO evaluations_professeurs (etudiant_id, professeur_id, periode_id, criteres, commentaire)
       VALUES ($1, $2, $3, $4, $5)`,
      [etudiant_id, professeur_id, periode_id, JSON.stringify(criteres), commentaire || null]
    );

    res.status(201).json({ success: true, message: 'Évaluation soumise avec succès.' });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(403).json({ success: false, message: 'Vous avez déjà évalué ce professeur pour cette période.' });
    }
    console.error('[soumettreEvaluation]', error);
    return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
  }
};

module.exports = {
  creerPeriode,
  getPeriodes,
  cloturerPeriode,
  getResultatsPeriode,
  getEvaluationsAFaire,
  soumettreEvaluation,
};