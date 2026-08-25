const express = require('express');
const router = express.Router();
const { soumettreEvaluation, getResultats } = require('../controllers/evaluation.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// POST /api/evaluations - Étudiant seulement
router.post('/', authMiddleware, requireRole('etudiant'), soumettreEvaluation);

// GET /api/evaluations/resultats - Admin seulement
router.get('/resultats', authMiddleware, requireRole('admin', 'direction'), getResultats);

module.exports = router;
