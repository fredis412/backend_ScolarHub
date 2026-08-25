const express = require('express');
const router = express.Router();
const {
  getMesPaiements,
  initierPaiement,
  confirmerPaiement,
  getPaiementsAdmin,
} = require('../controllers/paiements.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/paiements - Frais + historique de l'étudiant connecté
router.get('/', authMiddleware, getMesPaiements);

// POST /api/paiements/initier - Lancer un paiement mobile money
router.post('/initier', authMiddleware, initierPaiement);

// POST /api/paiements/:id/confirmer - Confirmer avec le code OTP
router.post('/:id/confirmer', authMiddleware, confirmerPaiement);

// GET /api/paiements/admin/all - Tous les paiements (admin)
router.get('/admin/all', authMiddleware, requireRole('admin'), getPaiementsAdmin);

module.exports = router;
