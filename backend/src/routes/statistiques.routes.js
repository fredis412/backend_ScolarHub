const express = require('express');
const router = express.Router();
const { getNotesStatistiques, getInscriptionsParMois } = require('../controllers/statistiques.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/statistiques/notes - Admin dashboard
router.get('/notes', authMiddleware, requireRole('admin', 'direction'), getNotesStatistiques);

// GET /api/statistiques/inscriptions - Évolution des inscriptions (12 derniers mois)
router.get('/inscriptions', authMiddleware, requireRole('admin', 'direction'), getInscriptionsParMois);

module.exports = router;