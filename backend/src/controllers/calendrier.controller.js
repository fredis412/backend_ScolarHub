const pool = require('../config/db');

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
const etabCol = (params, etabId, col) => {
  if (!etabId) return '';
  params.push(etabId);
  return ` AND ${col} = $${params.length}`;
};

const TYPES = ['Académique', 'Examens', 'Résultats', 'Vacances', 'Urgent'];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLS = `id, titre, COALESCE(description, '') AS description, type,
              to_char(date_debut, 'YYYY-MM-DD') AS date_debut,
              to_char(date_fin, 'YYYY-MM-DD') AS date_fin`;

// Valide et nettoie le corps de la requête. Renvoie { err } ou { v }.
const lireCorps = (b) => {
  const titre = String(b.titre || '').trim();
  const description = String(b.description || '').trim();
  const type = TYPES.includes(b.type) ? b.type : 'Académique';
  const debut = String(b.date_debut || '').trim();
  const fin = String(b.date_fin || '').trim();
  if (!titre) return { err: 'Le titre est requis.' };
  if (titre.length > 120) return { err: 'Le titre est trop long (120 caractères maximum).' };
  if (description.length > 500) return { err: 'La description est trop longue (500 caractères maximum).' };
  if (!RE_DATE.test(debut) || Number.isNaN(Date.parse(debut))) return { err: 'La date de début est invalide.' };
  if (fin && (!RE_DATE.test(fin) || Number.isNaN(Date.parse(fin)))) return { err: 'La date de fin est invalide.' };
  if (fin && fin < debut) return { err: 'La date de fin doit être après la date de début.' };
  return { v: { titre, description: description || null, type, debut, fin: fin || null } };
};

// GET /api/calendrier — dates de MON établissement (étudiants, professeurs, parents, admins)
exports.lister = async (req, res) => {
  try {
    const p = [];
    const f = etabCol(p, req.etablissementId, 'etablissement_id');
    const r = await pool.query(
      `SELECT ${COLS} FROM calendrier_academique WHERE 1=1${f} ORDER BY date_debut ASC, id ASC LIMIT 300`, p
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[calendrier] GET /', err.message);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du calendrier.' });
  }
};

// POST /api/calendrier (admin)
exports.creer = async (req, res) => {
  try {
    const { err, v } = lireCorps(req.body || {});
    if (err) return res.status(400).json({ success: false, message: err });
    const r = await pool.query(
      `INSERT INTO calendrier_academique (etablissement_id, titre, description, type, date_debut, date_fin)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLS}`,
      [req.etablissementId || null, v.titre, v.description, v.type, v.debut, v.fin]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[calendrier] POST /', err.message);
    res.status(500).json({ success: false, message: "Erreur lors de l'ajout de la date." });
  }
};

// PUT /api/calendrier/:id (admin)
exports.modifier = async (req, res) => {
  try {
    const { err, v } = lireCorps(req.body || {});
    if (err) return res.status(400).json({ success: false, message: err });
    const p = [v.titre, v.description, v.type, v.debut, v.fin, req.params.id];
    const r = await pool.query(
      `UPDATE calendrier_academique
          SET titre = $1, description = $2, type = $3, date_debut = $4, date_fin = $5
        WHERE id = $6${etabCol(p, req.etablissementId, 'etablissement_id')}
        RETURNING ${COLS}`, p
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Date introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[calendrier] PUT /:id', err.message);
    res.status(500).json({ success: false, message: 'Erreur lors de la modification.' });
  }
};

// DELETE /api/calendrier/:id (admin)
exports.supprimer = async (req, res) => {
  try {
    const p = [req.params.id];
    const r = await pool.query(
      `DELETE FROM calendrier_academique WHERE id = $1${etabCol(p, req.etablissementId, 'etablissement_id')} RETURNING id`, p
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Date introuvable.' });
    res.json({ success: true, message: 'Date supprimée.' });
  } catch (err) {
    console.error('[calendrier] DELETE /:id', err.message);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression.' });
  }
};
