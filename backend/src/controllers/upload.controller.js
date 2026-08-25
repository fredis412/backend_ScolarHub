/**
 * Contrôleur pour les uploads de fichiers (copies d'examen, etc.)
 */

// POST /api/upload/copie - Upload une copie d'examen
exports.uploadExamCopy = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier uploadé.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Fichier uploadé avec succès.',
      url: req.uploadedFileUrl,
    });
  } catch (error) {
    console.error('[uploadExamCopy] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'upload du fichier.',
      error: error.message,
    });
  }
};
