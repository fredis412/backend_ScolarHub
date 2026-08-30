const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole, optionalAuth } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');
const annonceController = require('../controllers/annonces.controller');

/**
 * Routes pour la gestion des Annonces
 * Authentification requise pour la plupart des opérations
 */

// GET /api/annonces - Récupérer les annonces (auth optionnelle pour filtrage par role)
router.get('/', optionalAuth, annonceController.getAllAnnonces);

// GET /api/annonces/:id - Récupérer une annonce spécifique
router.get('/:id', optionalAuth, annonceController.getAnnonceById);

// POST /api/annonces - Créer une annonce (admin, professeur ou étudiant)
router.post(
  '/',
  authMiddleware,
  requireRole('admin', 'administrateur', 'administrator', 'admi', 'super_admin', 'professeur', 'etudiant'),
  annonceController.createAnnonce
);

// PUT /api/annonces/:id - Modifier une annonce
router.put(
  '/:id',
  authMiddleware,
  annonceController.updateAnnonce
);

// DELETE /api/annonces/:id - Supprimer une annonce
router.delete(
  '/:id',
  authMiddleware,
  annonceController.deleteAnnonce
);

// PATCH /api/annonces/:id/publier - Publier une annonce
router.patch(
  '/:id/publier',
  authMiddleware,
  annonceController.publishAnnonce
);

// POST /api/annonces/:id/fichier - Upload un fichier à une annonce
router.post(
  '/:id/fichier',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/annonces'),
  annonceController.uploadAnnonceFile
);

module.exports = router;
