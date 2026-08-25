const express = require('express');
const router = express.Router();
const professeurController = require('../controllers/professeurController');

router.get('/', professeurController.getAllProfesseurs);
router.post('/', professeurController.createProfesseur);
router.put('/:id', professeurController.updateProfesseur);
router.get('/:id/modules', professeurController.getModulesByProfesseur);
router.patch('/assign-module', professeurController.patchModuleAssignment);

module.exports = router;
