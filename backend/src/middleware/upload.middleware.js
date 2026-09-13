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
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream', // Flutter Web envoie ce type générique
  ];

  const allowedExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];
  const ext = (file.originalname || '').toLowerCase().slice(file.originalname.lastIndexOf('.'));

  if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Format de fichier non autorisé. Acceptés : PDF, images, Word, PowerPoint, Excel. Reçu : ${file.mimetype} (${ext})`
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

      // Upload sur Cloudinary (ou Fallback Base64)
      const url = await CloudinaryService.uploadFile(
        req.file.buffer,
        fileName,
        folder,
        req.file.mimetype
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
