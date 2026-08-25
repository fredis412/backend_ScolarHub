const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/reclamations - Liste des reclamations
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'direction';
    let query, params;

    if (isAdmin) {
      query = `
        SELECT r.*, u.nom, u.prenoms, u.matricule, m.nom AS module_nom
        FROM reclamations r
        JOIN users u ON u.id = r.etudiant_id
        LEFT JOIN modules m ON m.id::text = r.module_id::text
        ORDER BY r.created_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT r.*, m.nom AS module_nom
        FROM reclamations r
        LEFT JOIN modules m ON m.id::text = r.module_id::text
        WHERE r.etudiant_id = $1
        ORDER BY r.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[reclamations] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// POST /api/reclamations - Creer une reclamation
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { module_id, type, justification } = req.body;
    if (!type?.trim() || !justification?.trim()) {
      return res.status(400).json({ success: false, message: 'Type et justification requis.' });
    }
    const result = await pool.query(
      `INSERT INTO reclamations (etudiant_id, module_id, type, justification, statut)
       VALUES ($1, $2, $3, $4, 'en_attente') RETURNING *`,
      [req.user.id, module_id || null, type.trim(), justification.trim()]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[reclamations] POST /', err);
    res.status(500).json({ success: false, message: 'Erreur creation reclamation.' });
  }
});

// GET /api/reclamations/:id - Detaille d'une reclamation
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.nom, u.prenoms, u.matricule, m.nom AS module_nom
       FROM reclamations r
       JOIN users u ON u.id = r.etudiant_id
       LEFT JOIN modules m ON m.id::text = r.module_id::text
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Reclamation non trouvee.' });
    }
    const rec = result.rows[0];
    if (rec.etudiant_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'direction') {
      return res.status(403).json({ success: false, message: 'Acces refuse.' });
    }
    res.json({ success: true, data: rec });
  } catch (err) {
    console.error('[reclamations] GET /:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// PATCH /api/reclamations/:id - Mettre a jour le statut (admin)
router.patch('/:id', authMiddleware, requireRole('admin', 'direction', 'professeur'), async (req, res) => {
  try {
    const { statut } = req.body;
    if (!statut?.trim()) {
      return res.status(400).json({ success: false, message: 'Statut requis.' });
    }
    const result = await pool.query(
      `UPDATE reclamations SET statut = $1 WHERE id = $2 RETURNING *`,
      [statut.trim(), req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Reclamation non trouvee.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[reclamations] PATCH /:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;
