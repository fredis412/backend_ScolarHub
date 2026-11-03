const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const c = require('../controllers/archives.controller');

const admin = requireRole('admin', 'direction');

router.get('/mes-annees', authMiddleware, c.mesAnnees);
router.get('/mon-annee', authMiddleware, c.monAnnee);
router.get('/diplomes', authMiddleware, admin, c.diplomes);
router.get('/etudiant/:id', authMiddleware, admin, c.parcoursEtudiant);

module.exports = router;
