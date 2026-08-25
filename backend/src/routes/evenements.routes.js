const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole, optionalAuth } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');
const evenementController = require('../controllers/evenements.controller');

/**
 * Routes pour la gestion des Événements
 * Étudiants et admins peuvent créer un événement ;
 * les étudiants s'inscrivent via la fiche d'inscription.
 */

// GET /api/evenements - Liste des événements
router.get('/', optionalAuth, evenementController.getAllEvenements);

// GET /api/evenements/admin/inscriptions - Historique des inscriptions
// (admin + étudiants : le bureau des étudiants suit les inscriptions)
router.get(
  '/admin/inscriptions',
  authMiddleware,
  requireRole('admin', 'etudiant'),
  evenementController.getAllInscriptions
);

// GET /api/evenements/:id - Détail d'un événement
router.get('/:id', optionalAuth, evenementController.getEvenementById);

// POST /api/evenements - Créer un événement (étudiant, professeur ou admin)
router.post(
  '/',
  authMiddleware,
  requireRole('admin', 'professeur', 'etudiant'),
  evenementController.createEvenement
);

// PATCH /api/evenements/:id/statut - Approuver / annuler (admin)
router.patch(
  '/:id/statut',
  authMiddleware,
  requireRole('admin'),
  evenementController.updateStatut
);

// DELETE /api/evenements/:id - Supprimer (auteur ou admin)
router.delete('/:id', authMiddleware, evenementController.deleteEvenement);

// POST /api/evenements/:id/affiche - Upload de l'affiche
router.post(
  '/:id/affiche',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/evenements'),
  evenementController.uploadAffiche
);

// POST /api/evenements/:id/inscriptions - Fiche d'inscription
router.post('/:id/inscriptions', authMiddleware, evenementController.inscrire);

// GET /api/evenements/:id/inscriptions - Liste des inscrits (auteur ou admin)
router.get('/:id/inscriptions', authMiddleware, evenementController.getInscriptions);

module.exports = router;
