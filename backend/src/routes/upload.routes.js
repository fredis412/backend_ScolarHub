const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');
const uploadController = require('../controllers/upload.controller');

/**
 * Routes pour les uploads de fichiers
 * (copies d'examen, pièces jointes, etc.)
 */

// POST /api/upload/copie - Upload une copie d'examen
router.post(
  '/copie',
  authMiddleware,
  upload.single('file'),
  uploadToCloudinary('scolarhub/copies-examen'),
  uploadController.uploadExamCopy
);

module.exports = router;
