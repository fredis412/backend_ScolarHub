const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');
const edtController = require('../controllers/edt.controller');

/**
 * Routes pour la gestion des Emplois Du Temps (EDT)
 * Authentification requise pour les opérations sensibles
 */

// GET /api/edt - Récupérer l'EDT de l'étudiant connecté
router.get(
  '/',
  authMiddleware,
  edtController.getStudentEdt
);

// GET /api/edt/admin/all - Récupérer tous les EDT (admin seulement)
router.get(
  '/admin/all',
  authMiddleware,
  requireRole('admin'),
  edtController.getAllEdt
);

// POST /api/edt/grille - Créer un EDT au format grille (jours/heures/salle), sans PDF
router.post(
  '/grille',
  authMiddleware,
  requireRole('admin'),
  edtController.createEdtGrille
);

// PUT /api/edt/grille/:id - Modifier les créneaux d'un EDT grille
router.put(
  '/grille/:id',
  authMiddleware,
  requireRole('admin'),
  edtController.updateEdtGrille
);

// GET /api/edt/:id - Récupérer un EDT spécifique
router.get(
  '/:id',
  authMiddleware,
  edtController.getEdtById
);

// POST /api/edt - Créer/Uploader un nouvel EDT
router.post(
  '/',
  authMiddleware,
  requireRole('admin'),
  upload.single('file'),
  uploadToCloudinary('scolarhub/edt'),
  edtController.createEdt
);

// PUT /api/edt/:id - Mettre à jour un EDT
router.put(
  '/:id',
  authMiddleware,
  requireRole('admin'),
  upload.single('file'),
  uploadToCloudinary('scolarhub/edt'),
  edtController.updateEdt
);

// POST /api/edt/:id/envoyer - Notifier les étudiants (filière + niveau)
router.post(
  '/:id/envoyer',
  authMiddleware,
  requireRole('admin'),
  edtController.envoyerEdt
);

// PATCH /api/edt/:id/archiver - Archiver un EDT
router.patch(
  '/:id/archiver',
  authMiddleware,
  requireRole('admin'),
  edtController.archiveEdt
);

// DELETE /api/edt/:id - Supprimer un EDT
router.delete(
  '/:id',
  authMiddleware,
  requireRole('admin'),
  edtController.deleteEdt
);

module.exports = router;
