const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// Configuration de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Service pour la gestion des uploads sur Cloudinary
 */
const CloudinaryService = {
  /**
   * Upload un fichier sur Cloudinary
   * @param {Buffer} fileBuffer - Contenu du fichier
   * @param {string} fileName - Nom du fichier
   * @param {string} folder - Dossier Cloudinary où stocker le fichier
   * @returns {Promise<string>} URL du fichier uploadé
   */
  async uploadFile(fileBuffer, fileName, folder = 'scolarhub') {
    if (!process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY === 'your_cloudinary_api_key') {
      throw new Error('Les identifiants Cloudinary ne sont pas configurés dans le fichier .env');
    }

    try {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: folder,
            resource_type: 'auto',
            public_id: fileName.replace(/\.[^.]+$/, ''),
          },
          (error, result) => {
            if (error) {
              console.error('[CloudinaryService.uploadFile] Erreur :', error);
              reject(error);
            } else {
              resolve(result.secure_url);
            }
          }
        );

        uploadStream.end(fileBuffer);
      });
    } catch (error) {
      console.error('[CloudinaryService.uploadFile] Erreur :', error);
      throw error;
    }
  },

  /**
   * Supprime un fichier de Cloudinary par son public_id
   * @param {string} publicId - Public ID du fichier Cloudinary
   * @returns {Promise<void>}
   */
  async deleteFile(publicId) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      console.log('[CloudinaryService.deleteFile] Fichier supprimé :', publicId);
      return result;
    } catch (error) {
      console.error('[CloudinaryService.deleteFile] Erreur :', error);
      throw error;
    }
  },

  /**
   * Extrait le public_id d'une URL Cloudinary
   * @param {string} url - URL Cloudinary complète
   * @returns {string} Public ID
   */
  extractPublicId(url) {
    try {
      const match = url.match(/\/([^/]+)\/([^/]+)\.([a-z]+)$/);
      return match ? `${match[1]}/${match[2]}` : null;
    } catch (error) {
      console.error('[CloudinaryService.extractPublicId] Erreur :', error);
      return null;
    }
  },
};

module.exports = CloudinaryService;
