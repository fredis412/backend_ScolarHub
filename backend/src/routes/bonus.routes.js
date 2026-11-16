const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bonus.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

router.get('/module/:moduleId', authMiddleware, ctrl.getBonusModule);
router.post('/', authMiddleware, ctrl.ajouterBonus);
router.delete('/:id', authMiddleware, ctrl.supprimerBonus);

module.exports = router;
