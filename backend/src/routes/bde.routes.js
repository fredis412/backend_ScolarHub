const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/bde/evenements - Liste des evenements BDE
router.get('/evenements', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.titre, a.contenu, a.filiere_nom, a.niveau, a.statut,
             a."createdAt", u.nom AS auteur_nom, u.prenoms AS auteur_prenoms
      FROM annonces a
      LEFT JOIN users u ON u.id = a.auteur
      WHERE a."cibleRole" = 'bde' OR a."cibleRole" = 'tous'
      ORDER BY a."createdAt" DESC
      LIMIT 20
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[bde] GET /evenements', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// GET /api/bde/membres - Liste des membres BDE
router.get('/membres', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nom, u.prenoms, u.matricule, u.email, u.etudiant_role
      FROM users u
      WHERE u.etudiant_role = 'bde' OR u.etudiant_role = 'delegue'
      ORDER BY u.nom
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[bde] GET /membres', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;
