const express = require('express');
const router = express.Router();
const filiereController = require('../controllers/filiereController');

router.get('/', filiereController.getAllFilieres);
router.post('/', filiereController.createFiliere);
router.put('/:id', filiereController.updateFiliere);
router.delete('/:id', filiereController.deleteFiliere);
router.get('/:id/etudiants', filiereController.getEtudiantsByFiliere);

module.exports = router;
