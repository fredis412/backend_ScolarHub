const express = require('express');
const router = express.Router();
const { chat, getHistorique, getSupportsRevision, genererRevision } = require('../controllers/ia.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

// POST /api/ia/chat - Envoyer un message a Claude
router.post('/chat', authMiddleware, chat);

// GET /api/ia/historique - Recuperer l'historique
router.get('/historique', authMiddleware, getHistorique);

// GET /api/ia/supports - Cours disponibles pour la révision (étudiant)
router.get('/supports', authMiddleware, getSupportsRevision);

// POST /api/ia/revision - Générer un quiz ou une fiche de révision
router.post('/revision', authMiddleware, genererRevision);

module.exports = router;
