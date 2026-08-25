const express = require('express');
const router = express.Router();
const membreController = require('../controllers/membreController');

router.post('/', membreController.createMembre);
router.post('/login', membreController.login);
router.get('/', membreController.getAllMembres);
router.patch('/:id/permissions', membreController.updatePermissions);
router.delete('/:id', membreController.deleteMembre);

module.exports = router;
