const express = require('express');
const router = express.Router();
const etudiantController = require('../controllers/etudiantController');

router.post('/login', etudiantController.loginEtudiant);
router.post('/finaliser', etudiantController.finaliserInscription);

module.exports = router;
