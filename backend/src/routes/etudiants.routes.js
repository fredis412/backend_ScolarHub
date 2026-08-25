const express = require('express');
const router = express.Router();
const etudiantsController = require('../controllers/etudiants.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

router.get('/', authMiddleware, etudiantsController.listEtudiants);
router.post('/', authMiddleware, requireRole('admin'), etudiantsController.inscrireEtudiant);
// Route publique — activation du compte lors de la première connexion
router.post('/finaliser', etudiantsController.finaliserPremiereConnexion);

module.exports = router;
