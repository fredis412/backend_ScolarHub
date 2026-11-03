const express = require('express');
const router = express.Router();
const bulletinsController = require('../controllers/bulletins.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { exigerAnneeOuverte } = require('../middleware/anneeOuverte');

// ── Admin : préparation et publication des bulletins ────────────────────────
router.get('/preparation', authMiddleware, requireRole('admin'), bulletinsController.getPreparationBulletin);
router.post('/publier', authMiddleware, requireRole('admin'), exigerAnneeOuverte(), bulletinsController.publierBulletins);

// ── Admin : règles de validation du semestre (général ou par UE) ────────────
router.get('/regles', authMiddleware, requireRole('admin'), bulletinsController.getRegles);
router.put('/regles', authMiddleware, requireRole('admin'), bulletinsController.saveRegles);

// ── Admin : prévision de moyenne (ancien circuit) ───────────────────────────
router.get('/prevision', authMiddleware, requireRole('admin'), bulletinsController.getPrevisionMoyenne);
router.post('/prevision/envoyer', authMiddleware, requireRole('admin'), bulletinsController.envoyerPrevision);

// ── Étudiant connecté : uniquement SES données ──────────────────────────────
router.get('/mon-bulletin', authMiddleware, bulletinsController.getMonBulletin);
router.get('/mes-previsions', authMiddleware, bulletinsController.getMesPrevisions);

module.exports = router;