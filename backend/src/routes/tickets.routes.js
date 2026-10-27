const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// ── Isolation par établissement ─────────────────────────────────────────────
// Un ticket appartient à l'établissement de son étudiant (users.etablissement_id).
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
async function ticketDeMonEtab(req, id) {
  if (!req.etablissementId) return true;
  const r = await pool.query(
    `SELECT 1 FROM tickets t JOIN users u ON u.id = t.etudiant_id
     WHERE t.id = $1 AND u.etablissement_id = $2`,
    [id, req.etablissementId]
  );
  return r.rows.length > 0;
}

// GET /api/tickets - Liste des tickets (paiements)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'direction';
    let query, params;

    if (isAdmin) {
      query = `
        SELECT t.*, u.nom, u.prenoms, u.matricule
        FROM tickets t
        JOIN users u ON u.id = t.etudiant_id
        ${req.etablissementId ? 'WHERE u.etablissement_id = $1' : ''}
        ORDER BY t.created_at DESC
      `;
      params = req.etablissementId ? [req.etablissementId] : [];
    } else {
      query = `SELECT * FROM tickets WHERE etudiant_id = $1 ORDER BY created_at DESC`;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[tickets] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// POST /api/tickets - Creer un ticket de paiement
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { montant } = req.body;
    if (!montant || isNaN(montant) || Number(montant) <= 0) {
      return res.status(400).json({ success: false, message: 'Montant valide requis.' });
    }
    const result = await pool.query(
      `INSERT INTO tickets (etudiant_id, montant, statut)
       VALUES ($1, $2, 'en_attente') RETURNING *`,
      [req.user.id, montant]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[tickets] POST /', err);
    res.status(500).json({ success: false, message: 'Erreur creation ticket.' });
  }
});

// GET /api/tickets/:id - Detaille d'un ticket
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.nom, u.prenoms, u.matricule
       FROM tickets t JOIN users u ON u.id = t.etudiant_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0] || !(await ticketDeMonEtab(req, req.params.id))) {
      return res.status(404).json({ success: false, message: 'Ticket non trouve.' });
    }
    const ticket = result.rows[0];
    if (ticket.etudiant_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'direction') {
      return res.status(403).json({ success: false, message: 'Acces refuse.' });
    }
    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('[tickets] GET /:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// PATCH /api/tickets/:id - Valider/rejeter un ticket (admin)
router.patch('/:id', authMiddleware, requireRole('admin', 'direction'), async (req, res) => {
  try {
    const { statut, qr_code } = req.body;
    if (!(await ticketDeMonEtab(req, req.params.id))) {
      return res.status(404).json({ success: false, message: 'Ticket non trouve.' });
    }
    const result = await pool.query(
      `UPDATE tickets SET statut = COALESCE($1, statut), qr_code = COALESCE($2, qr_code)
       WHERE id = $3 RETURNING *`,
      [statut, qr_code, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Ticket non trouve.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[tickets] PATCH /:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;