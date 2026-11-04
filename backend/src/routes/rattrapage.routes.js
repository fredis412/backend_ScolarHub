const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const c = require('../controllers/rattrapage.controller');

const prof = requireRole('professeur', 'admin', 'direction');
const admin = requireRole('admin', 'direction');

// Étudiant
router.get('/ma-situation', authMiddleware, c.maSituation);
router.get('/mes-notes', authMiddleware, c.mesNotes);

// Professeur (et administration)
router.get('/apercu', authMiddleware, prof, c.apercu);
router.get('/mes-sessions', authMiddleware, requireRole('professeur'), c.mesSessions);
router.post('/sessions', authMiddleware, requireRole('professeur'), c.creerSession);
router.post('/sessions/:id/envoyer', authMiddleware, requireRole('professeur'), c.envoyerSession);
router.get('/sessions/:id', authMiddleware, prof, c.detailSession);

// Administration
router.get('/admin/sessions', authMiddleware, admin, c.listerSessionsAdmin);
router.patch('/admin/sessions/:id/valider', authMiddleware, admin, c.validerSession);
router.patch('/admin/sessions/:id/rejeter', authMiddleware, admin, c.rejeterSession);

module.exports = router;
