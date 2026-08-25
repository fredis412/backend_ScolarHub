const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/canaux - Liste de tous les canaux
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.nom, c.description, c.type, c.created_at,
             (SELECT COUNT(*) FROM canal_membres cm WHERE cm.canal_id = c.id) AS nb_membres
      FROM canaux c
      ORDER BY c.nom
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[canaux] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// POST /api/canaux - Creer un canal (admin)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { nom, description, type } = req.body;
    if (!nom?.trim()) {
      return res.status(400).json({ success: false, message: 'Nom du canal requis.' });
    }
    const result = await pool.query(
      `INSERT INTO canaux (nom, description, type) VALUES ($1, $2, $3) RETURNING *`,
      [nom.trim(), description || null, type || 'general']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[canaux] POST /', err);
    res.status(500).json({ success: false, message: 'Erreur creation canal.' });
  }
});

// POST /api/canaux/:id/membres - Ajouter un membre a un canal
router.post('/:id/membres', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { user_id, role } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'user_id requis.' });
    }
    await pool.query(
      `INSERT INTO canal_membres (canal_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (canal_id, user_id) DO UPDATE SET role = $3`,
      [req.params.id, user_id, role || 'membre']
    );
    res.status(201).json({ success: true, message: 'Membre ajoute au canal.' });
  } catch (err) {
    console.error('[canaux] POST /:id/membres', err);
    res.status(500).json({ success: false, message: 'Erreur ajout membre.' });
  }
});

// GET /api/canaux/:id/membres - Liste des membres d'un canal
router.get('/:id/membres', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nom, u.prenoms, u.matricule, u.role, cm.role AS canal_role
      FROM canal_membres cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.canal_id = $1
      ORDER BY u.nom
    `, [req.params.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[canaux] GET /:id/membres', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// DELETE /api/canaux/:id - Supprimer un canal (admin)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM canaux WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Canal non trouve.' });
    }
    res.json({ success: true, message: 'Canal supprime.' });
  } catch (err) {
    console.error('[canaux] DELETE /:id', err);
    res.status(500).json({ success: false, message: 'Erreur suppression canal.' });
  }
});

module.exports = router;
