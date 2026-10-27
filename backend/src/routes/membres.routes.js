const express = require('express');
const router = express.Router();
const membresController = require('../controllers/membres.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// Toutes les routes exigent un administrateur connecté : le jeton fournit
// l'établissement (req.etablissementId) utilisé pour filtrer les données.
router.use(authMiddleware, requireRole('admin'));

// Droits de l'administrateur connecté (sert à filtrer son menu) — sans restriction.
router.get('/moi', membresController.getMesPermissions);

// Tout le reste : Super Admin ou autorisation « Créer des membres » uniquement.
router.use(membresController.exigerGestionMembres);

router.get('/', membresController.getAllMembres);
router.post('/', membresController.createMembre);
router.patch('/:id/permissions', membresController.updatePermissions);
router.patch('/:id/statut', membresController.changerStatutMembre);
router.put('/:id', membresController.updateMembre);
router.post('/:id/reinitialiser-mdp', membresController.reinitialiserMotDePasse);
router.delete('/:id', membresController.deleteMembre);

module.exports = router;