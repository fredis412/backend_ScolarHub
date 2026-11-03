const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const c = require('../controllers/reinscriptions.controller');

const admin = requireRole('admin', 'direction');

// Étudiant
router.get('/mon-statut', authMiddleware, c.monStatut);
router.post('/demander', authMiddleware, c.demander);

// Administration
router.get('/frais', authMiddleware, admin, c.listerFrais);
router.put('/frais', authMiddleware, admin, c.enregistrerFrais);
router.get('/admin', authMiddleware, admin, c.listerAdmin);
router.patch('/admin/:id/valider', authMiddleware, admin, c.valider);
router.patch('/admin/:id/refuser', authMiddleware, admin, c.refuser);

module.exports = router;
