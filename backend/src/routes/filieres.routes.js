const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// Les colonnes abreviation / domaine / responsable / statut sont optionnelles
// (migration SQL fournie). to_jsonb(f)->>'col' fonctionne même si la colonne
// n'existe pas encore : la route ne casse donc jamais avant la migration.
const SELECT_FILIERES = `
  SELECT f.id, f.nom, f.description,
         to_jsonb(f)->>'abreviation' AS abreviation,
         to_jsonb(f)->>'domaine'     AS domaine_col,
         to_jsonb(f)->>'responsable' AS responsable,
         to_jsonb(f)->>'statut'      AS statut,
         (SELECT COUNT(*) FROM etudiants e
           WHERE e.filiere_id = f.id AND (e.statut = 'actif' OR e.statut IS NULL))::int AS nb_etudiants,
         (SELECT COUNT(*) FROM modules m WHERE m.filiere_id = f.id)::int AS nb_modules,
         COALESCE((SELECT jsonb_object_agg(t.niveau, t.c)
                     FROM (SELECT e.niveau, COUNT(*)::int AS c FROM etudiants e
                            WHERE e.filiere_id = f.id AND (e.statut = 'actif' OR e.statut IS NULL)
                              AND e.niveau IS NOT NULL AND e.niveau <> ''
                            GROUP BY e.niveau) t), '{}'::jsonb) AS par_niveau,
         COALESCE((SELECT array_agg(DISTINCT e.niveau ORDER BY e.niveau)
                     FROM etudiants e
                    WHERE e.filiere_id = f.id AND e.niveau IS NOT NULL AND e.niveau <> ''), '{}') AS niveaux
    FROM filieres f
`;

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
// Une filière appartient à un établissement (filieres.etablissement_id).
const etabCol = (params, etabId, col) => {
  if (!etabId) return '';
  params.push(etabId);
  return ` AND ${col} = $${params.length}`;
};

// GET /api/filieres — liste enrichie (effectifs, niveaux, modules)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const p = [];
    const result = await pool.query(`${SELECT_FILIERES} WHERE 1=1${etabCol(p, req.etablissementId, 'f.etablissement_id')} ORDER BY f.nom`, p);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('[filieres] GET /', err.message);
    // Repli : liste minimale si la requête enrichie échoue (ex. schéma différent)
    try {
      const pb = [];
      const basic = await pool.query(`SELECT id, nom, description FROM filieres WHERE 1=1${etabCol(pb, req.etablissementId, 'etablissement_id')} ORDER BY nom`, pb);
      return res.status(200).json(basic.rows);
    } catch (err2) {
      console.error('[filieres]', err2.message);
      return res.status(500).json({ message: 'Erreur chargement filieres.' });
    }
  }
});

const EXTRA = ['abreviation', 'domaine', 'responsable', 'statut'];

// POST /api/filieres — créer
router.post('/', authMiddleware, requireRole('admin', 'super_admin'), async (req, res) => {
  const { nom, description } = req.body;
  if (!nom?.trim()) return res.status(400).json({ message: 'Nom de filière requis.' });
  try {
    // Refuser un nom déjà utilisé dans le même établissement (sans tenir compte des majuscules/espaces).
    const pd = [nom.trim()];
    const doublon = await pool.query(
      `SELECT id FROM filieres WHERE LOWER(TRIM(nom)) = LOWER($1)${etabCol(pd, req.etablissementId, 'etablissement_id')}`,
      pd
    );
    if (doublon.rows[0]) {
      return res.status(409).json({ message: `La filière « ${nom.trim()} » existe déjà.` });
    }

    const cols = ['nom', 'description'];
    const vals = [nom.trim(), description || null];
    if (req.etablissementId) { cols.push('etablissement_id'); vals.push(req.etablissementId); }
    for (const k of EXTRA) {
      if (req.body[k]) { cols.push(k); vals.push(String(req.body[k]).trim()); }
    }
    let row;
    try {
      const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
      row = (await pool.query(`INSERT INTO filieres (${cols.join(', ')}) VALUES (${ph}) RETURNING *`, vals)).rows[0];
    } catch (e) {
      if (e.code !== '42703') throw e; // colonne manquante -> repli sans colonnes optionnelles
      row = req.etablissementId
        ? (await pool.query('INSERT INTO filieres (nom, description, etablissement_id) VALUES ($1, $2, $3) RETURNING *', [vals[0], vals[1], req.etablissementId])).rows[0]
        : (await pool.query('INSERT INTO filieres (nom, description) VALUES ($1, $2) RETURNING *', [vals[0], vals[1]])).rows[0];
    }
    return res.status(201).json(row);
  } catch (err) {
    console.error('[filieres] POST /', err.message);
    return res.status(500).json({ message: 'Erreur création filière.' });
  }
});

// PUT /api/filieres/:id — modifier
router.put('/:id', authMiddleware, requireRole('admin', 'super_admin'), async (req, res) => {
  const { nom } = req.body;
  if (!nom?.trim()) return res.status(400).json({ message: 'Nom de filière requis.' });
  try {
    const pe = [req.params.id];
    const exists = await pool.query(`SELECT id, description FROM filieres WHERE id = $1${etabCol(pe, req.etablissementId, 'etablissement_id')}`, pe);
    if (!exists.rows[0]) return res.status(404).json({ message: 'Filière non trouvée.' });

    // Le nouveau nom ne doit pas déjà appartenir à une AUTRE filière de l'établissement.
    const pd = [nom.trim(), req.params.id];
    const doublon = await pool.query(
      `SELECT id FROM filieres WHERE LOWER(TRIM(nom)) = LOWER($1) AND id <> $2${etabCol(pd, req.etablissementId, 'etablissement_id')}`,
      pd
    );
    if (doublon.rows[0]) {
      return res.status(409).json({ message: `La filière « ${nom.trim()} » existe déjà.` });
    }

    const sets = ['nom = $1'];
    const vals = [nom.trim()];
    for (const k of EXTRA) {
      if (req.body[k] !== undefined) {
        vals.push(String(req.body[k] ?? '').trim() || null);
        sets.push(`${k} = $${vals.length}`);
      }
    }
    vals.push(req.params.id);
    let partial = false;
    let row;
    try {
      row = (await pool.query(`UPDATE filieres SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)).rows[0];
    } catch (e) {
      if (e.code !== '42703') throw e;
      partial = true; // colonnes optionnelles absentes : on enregistre au moins le nom
      row = (await pool.query('UPDATE filieres SET nom = $1 WHERE id = $2 RETURNING *', [nom.trim(), req.params.id])).rows[0];
    }
    return res.json({ success: true, data: row, partial });
  } catch (err) {
    console.error('[filieres] PUT /:id', err.message);
    return res.status(500).json({ message: 'Erreur modification filière.' });
  }
});

// DELETE /api/filieres/:id — supprimer (refusé si étudiants ou modules rattachés)
router.delete('/:id', authMiddleware, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const pc = [req.params.id];
    const okEtab = await pool.query(`SELECT 1 FROM filieres WHERE id = $1${etabCol(pc, req.etablissementId, 'etablissement_id')}`, pc);
    if (!okEtab.rows[0]) return res.status(404).json({ message: 'Filière non trouvée.' });
    const c = await pool.query(
      `SELECT (SELECT COUNT(*) FROM etudiants WHERE filiere_id = $1)::int AS etu,
              (SELECT COUNT(*) FROM modules   WHERE filiere_id = $1)::int AS mods`,
      [req.params.id]
    );
    const { etu, mods } = c.rows[0];
    if (etu > 0 || mods > 0) {
      return res.status(409).json({
        message: `Suppression impossible : ${etu} étudiant(s) et ${mods} module(s) sont rattachés à cette filière.`,
      });
    }
    const r = await pool.query('DELETE FROM filieres WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ message: 'Filière non trouvée.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[filieres] DELETE /:id', err.message);
    return res.status(500).json({ message: 'Erreur suppression filière.' });
  }
});

module.exports = router;