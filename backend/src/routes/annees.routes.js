const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const c = require('../controllers/annees.controller');

const admin = requireRole('admin', 'direction');

router.get('/courante', authMiddleware, c.anneeCourante);
router.get('/mes-annees', authMiddleware, c.mesAnnees);
router.get('/', authMiddleware, admin, c.listerAnnees);
router.post('/', authMiddleware, admin, c.creerAnnee);
router.put('/:id/rattrapage', authMiddleware, admin, c.reglerRattrapage);
router.get('/:libelle/classe', authMiddleware, admin, c.classeDeLAnnee);

module.exports = router;
