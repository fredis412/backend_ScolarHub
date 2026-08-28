const express = require('express');
const router = express.Router();
const membresController = require('../controllers/membres.controller');

router.get('/', membresController.getAllMembres);
router.post('/', membresController.createMembre);
router.patch('/:id/permissions', membresController.updatePermissions);
router.delete('/:id', membresController.deleteMembre);

module.exports = router;
