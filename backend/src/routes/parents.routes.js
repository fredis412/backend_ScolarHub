const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/parents - Liste des parents avec leurs enfants
router.get('/', authMiddleware, requireRole('admin', 'direction'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        e.nom_parent, e.tel_parent, e.email_parent,
        e.nom AS etudiant_nom, e.prenoms AS etudiant_prenoms, e.matricule,
        e.filiere_nom, e.niveau
      FROM etudiants e
      WHERE e.nom_parent IS NOT NULL AND e.nom_parent != ''
      ORDER BY e.nom_parent
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[parents] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// GET /api/parents/enfant/:etudiantId - Info parent pour un etudiant
router.get('/enfant/:etudiantId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT nom_parent, tel_parent, email_parent FROM etudiants WHERE id = $1`,
      [req.params.etudiantId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Etudiant non trouve.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[parents] GET /enfant/:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// PUT /api/parents/enfant/:etudiantId - Mettre a jour info parent
router.put('/enfant/:etudiantId', authMiddleware, async (req, res) => {
  try {
    const { nom_parent, tel_parent, email_parent } = req.body;
    const result = await pool.query(
      `UPDATE etudiants SET nom_parent = COALESCE($1, nom_parent),
       tel_parent = COALESCE($2, tel_parent), email_parent = COALESCE($3, email_parent)
       WHERE id = $4 RETURNING nom_parent, tel_parent, email_parent`,
      [nom_parent, tel_parent, email_parent, req.params.etudiantId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Etudiant non trouve.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[parents] PUT /enfant/:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// GET /api/parents/enfant/:etudiantId/notes - Notes de l'enfant
router.get('/enfant/:etudiantId/notes', authMiddleware, async (req, res) => {
  try {
    const { etudiantId } = req.params;
    const result = await pool.query(
      `SELECT * FROM vue_notes_etudiants WHERE etudiant_id = $1 ORDER BY date_session DESC`,
      [etudiantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[parents] GET /enfant/:id/notes', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// GET /api/parents/enfant/:etudiantId/presences - Présences de l'enfant
router.get('/enfant/:etudiantId/presences', authMiddleware, async (req, res) => {
  try {
    const { etudiantId } = req.params;
    const result = await pool.query(
      `SELECT * FROM vue_presences_etudiants WHERE etudiant_id = $1 ORDER BY date_appel DESC`,
      [etudiantId]
    );

    const total = result.rows.length;
    const presentes = result.rows.filter(r => r.presence_statut === 'present').length;
    const absentes = result.rows.filter(r => r.presence_statut === 'absent').length;
    const retards = result.rows.filter(r => r.presence_statut === 'retard').length;

    res.json({
      success: true,
      data: result.rows,
      stats: { total, presentes, absentes, retards }
    });
  } catch (err) {
    console.error('[parents] GET /enfant/:id/presences', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;
