const express = require('express');
const router = express.Router();
const { getEtudiantsARisque, alerterEtudiant } = require('../controllers/risque.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/risque - Scores de risque de décrochage (admin)
router.get('/', authMiddleware, requireRole('admin'), getEtudiantsARisque);

// POST /api/risque/:etudiantId/alerter - Alerter étudiant + parent
router.post('/:etudiantId/alerter', authMiddleware, requireRole('admin'), alerterEtudiant);

module.exports = router;
