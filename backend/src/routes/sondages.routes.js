const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const sondagesController = require('../controllers/sondages.controller');

router.post('/', authMiddleware, sondagesController.creerSondage);
router.get('/:id', authMiddleware, sondagesController.getSondage);
router.post('/:id/voter', authMiddleware, sondagesController.voter);
router.patch('/:id/cloturer', authMiddleware, sondagesController.cloturerSondage);

module.exports = router;
