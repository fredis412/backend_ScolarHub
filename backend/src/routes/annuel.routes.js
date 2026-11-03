const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const c = require('../controllers/annuel.controller');

const admin = requireRole('admin', 'direction');

router.get('/etat', authMiddleware, admin, c.etat);
router.get('/decisions', authMiddleware, admin, c.apercuDecisions);
router.post('/decisions', authMiddleware, admin, c.validerDecisions);
router.post('/cloturer', authMiddleware, admin, c.cloturerAnnee);

module.exports = router;
