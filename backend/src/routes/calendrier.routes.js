const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const calendrierController = require('../controllers/calendrier.controller');

// Lecture : tout utilisateur connecté (filtré sur son établissement)
router.get('/', authMiddleware, calendrierController.lister);
// Gestion : administration
router.post('/', authMiddleware, requireRole('admin'), calendrierController.creer);
router.put('/:id', authMiddleware, requireRole('admin'), calendrierController.modifier);
router.delete('/:id', authMiddleware, requireRole('admin'), calendrierController.supprimer);

module.exports = router;
