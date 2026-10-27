const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');
const uploadController = require('../controllers/upload.controller');

/**
 * Routes pour les uploads de fichiers
 * (copies d'examen, photos de profil/couverture, pièces jointes, etc.)
 */

// POST /api/upload/copie - Upload une copie d'examen
router.post(
  '/copie',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/copies-examen'),
  uploadController.uploadExamCopy
);

// POST /api/upload/message — pièce jointe de message (doc/photo/vidéo/audio)
router.post(
  '/message',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/messages'),
  uploadController.uploadMessageFile
);

// Photo de profil / couverture — ouvert à tout utilisateur connecté, quel
// que soit son rôle (étudiant, professeur, admin, parent).
router.post(
  '/photo-profil',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/photos-profil'),
  uploadController.uploadPhotoProfil
);
router.delete('/photo-profil', authMiddleware, uploadController.deletePhotoProfil);

router.post(
  '/photo-couverture',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/photos-couverture'),
  uploadController.uploadPhotoCouverture
);
router.delete('/photo-couverture', authMiddleware, uploadController.deletePhotoCouverture);

// Attestation de service — même schéma que photo-profil/photo-couverture.
router.post(
  '/attestation-service',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/attestations-service'),
  uploadController.uploaderAttestationService
);
router.delete('/attestation-service', authMiddleware, uploadController.supprimerAttestationService);

// Logo de l'établissement — lecture : tout connecté ; écriture : Super Admin ou
// membre ayant l'autorisation « logo » (vérifiée AVANT l'envoi du fichier).
router.get('/logo-etablissement', authMiddleware, uploadController.getLogoEtablissement);
router.post(
  '/logo-etablissement',
  authMiddleware,
  uploadController.exigerGestionLogo,
  upload.single('file'),
  uploadToCloudinary('scolarhub/logo-etablissement'),
  uploadController.uploadLogoEtablissement
);
router.delete('/logo-etablissement', authMiddleware, uploadController.exigerGestionLogo, uploadController.deleteLogoEtablissement);

// Photo d'accueil (page de bienvenue après le code) — mêmes droits que le logo.
router.get('/photo-accueil', authMiddleware, uploadController.getPhotoAccueil);
router.post(
  '/photo-accueil',
  authMiddleware,
  uploadController.exigerGestionPhotoAccueil,
  upload.single('file'),
  uploadToCloudinary('scolarhub/photo-accueil'),
  uploadController.uploadPhotoAccueil
);
router.delete('/photo-accueil', authMiddleware, uploadController.exigerGestionPhotoAccueil, uploadController.deletePhotoAccueil);

module.exports = router;