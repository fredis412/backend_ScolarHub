const multer = require('multer');
const CloudinaryService = require('../services/cloudinary.service');

// Configuration Multer avec stockage en mémoire
const storage = multer.memoryStorage();

// Filtre pour accepter uniquement certains formats
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Format de fichier non autorisé. Acceptés : PDF, JPG, JPEG, PNG. Reçu : ${file.mimetype}`
      ),
      false
    );
  }
};

// Configuration Multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: fileFilter,
});

/**
 * Middleware pour upload de fichier avec Cloudinary
 * @param {string} folder - Dossier Cloudinary où stocker
 */
const uploadToCloudinary = (folder = 'scolarhub') => {
  return async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: 'Aucun fichier fourni.' });
      }

      // Génération d'un nom unique pour le fichier
      const fileName = `${Date.now()}-${req.file.originalname}`;

      // Upload sur Cloudinary
      const url = await CloudinaryService.uploadFile(
        req.file.buffer,
        fileName,
        folder
      );

      // Stocker l'URL et le public_id dans req pour l'utiliser dans le contrôleur
      req.uploadedFileUrl = url;
      req.uploadedFileName = fileName;

      next();
    } catch (error) {
      console.error('[uploadToCloudinary] Erreur :', error.message);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'upload du fichier.',
        error: error.message,
      });
    }
  };
};

module.exports = {
  upload,
  uploadToCloudinary,
};
