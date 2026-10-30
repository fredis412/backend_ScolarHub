const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const profilPublicController = require('../controllers/profilPublic.controller');

// Tout utilisateur connecté peut voir la fiche d'un membre de son établissement.
router.get('/:id', authMiddleware, profilPublicController.voir);

module.exports = router;
