const AnnonceModel = require('../models/annonceModel');
const CloudinaryService = require('../services/cloudinary.service');
const pool = require('../config/db');
const { resolveFiliere } = require('../utils/filieres');
const { envoyerNotificationAuto } = require('./notifications.controller');

async function notifierPublication(annonce) {
  const roleCible = annonce.cibleRole === 'tous' ? null : annonce.cibleRole;
  const { rows: destinataires } = await pool.query(
    `SELECT id FROM users
     WHERE ($2::integer IS NULL OR filiere_id = $2)
     ${roleCible ? 'AND role = $1' : ''}`,
    roleCible ? [roleCible, annonce.filiere || null] : [null, annonce.filiere || null],
  );
  await Promise.all(destinataires.map(({ id }) =>
    envoyerNotificationAuto(id, annonce.titre, annonce.contenu),
  ));
}

/**
 * Contrôleur pour les Annonces
 */

// GET /api/annonces - Récupérer les annonces filtrées
exports.getAllAnnonces = async (req, res) => {
  try {
    const { filiere, niveau, cibleRole, statut, limit = 20, offset = 0 } = req.query;
    const userRole = req.user?.role;
    const userFiliere = req.user?.filiere_id;

    // Construire les filtres
    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    // Appliquer les filtres selon le rôle
    if (userRole === 'etudiant') {
      // Les étudiants ne voient que les annonces publiées
      filters.statut = 'publie';
      // Filtrer par leur filière
      filters.filiere = userFiliere;
      // Une annonce sans filière cible tout l'établissement.
      filters.includeGlobal = true;
    } else if (userRole === 'admin' || userRole === 'professeur') {
      // Les admins et professeurs voient tout
      if (statut) filters.statut = statut;
      if (filiere) filters.filiere = filiere;
    } else {
      // Utilisateurs non authentifiés voient les annonces publiées
      filters.statut = 'publie';
    }

    // Ajouter les autres filtres
    if (niveau) filters.niveau = niveau;
    if (cibleRole && (userRole === 'admin' || userRole === 'professeur')) {
      filters.cibleRole = cibleRole;
    }

    const annonces = await AnnonceModel.findAll(filters);

    res.status(200).json({
      success: true,
      count: annonces.length,
      data: annonces,
    });
  } catch (error) {
    console.error('[getAllAnnonces] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des annonces.',
      error: error.message,
    });
  }
};

// GET /api/annonces/:id - Récupérer une annonce spécifique
exports.getAnnonceById = async (req, res) => {
  try {
    const { id } = req.params;

    const annonce = await AnnonceModel.findById(id);

    if (!annonce) {
      return res.status(404).json({
        success: false,
        message: 'Annonce non trouvée.',
      });
    }

    // Vérifier les permissions (étudiants ne voient que les annonces publiées)
    if (req.user?.role === 'etudiant' && annonce.statut !== 'publie') {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé à cette annonce.',
      });
    }

    res.status(200).json({
      success: true,
      data: annonce,
    });
  } catch (error) {
    console.error('[getAnnonceById] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'annonce.',
      error: error.message,
    });
  }
};

// POST /api/annonces - Créer une annonce
exports.createAnnonce = async (req, res) => {
  try {
    const { titre, contenu, filiere, niveau, cibleRole, statut, categorie } = req.body;
    const authorId = req.user?.id;

    // Validations
    if (!titre || !contenu) {
      return res.status(400).json({
        success: false,
        message: 'Titre et contenu sont obligatoires.',
      });
    }

    if (!cibleRole) {
      return res.status(400).json({
        success: false,
        message: 'Rôle cible (cibleRole) est obligatoire.',
      });
    }

    if (statut && !['brouillon', 'publie'].includes(statut)) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide. Valeurs autorisées : brouillon, publie.',
      });
    }

    const filiereInfo = await resolveFiliere(pool, filiere);

    const annonceData = {
      titre,
      contenu,
      filiere: filiereInfo.id || filiere || null,
      filiere_nom: filiereInfo.nom,
      niveau: niveau || null,
      cibleRole,
      categorie: categorie || null,
      statut: statut || 'brouillon',
      fichiers: [],
      auteur: authorId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newAnnonce = await AnnonceModel.create(annonceData);

    if (annonceData.statut === 'publie') {
      await notifierPublication(newAnnonce);
    }

    res.status(201).json({
      success: true,
      message: 'Annonce créée avec succès.',
      data: newAnnonce,
    });
  } catch (error) {
    console.error('[createAnnonce] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'annonce.',
      error: error.message,
    });
  }
};

// PUT /api/annonces/:id - Modifier une annonce
exports.updateAnnonce = async (req, res) => {
  try {
    const { id } = req.params;
    const { titre, contenu, filiere, niveau, cibleRole, statut, categorie } = req.body;
    const userId = req.user?.id;

    // Vérifier que l'annonce existe
    const annonce = await AnnonceModel.findById(id);
    if (!annonce) {
      return res.status(404).json({
        success: false,
        message: 'Annonce non trouvée.',
      });
    }

    // Vérifier que l'utilisateur est l'auteur ou un admin
    if (annonce.auteur !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Seul l\'auteur peut modifier cette annonce.',
      });
    }

    if (statut && !['brouillon', 'publie'].includes(statut)) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide. Valeurs autorisées : brouillon, publie.',
      });
    }

    const updateData = {
      ...(titre && { titre }),
      ...(contenu && { contenu }),
      ...(niveau && { niveau }),
      ...(cibleRole && { cibleRole }),
      ...(categorie && { categorie }),
      ...(statut && { statut }),
      updatedAt: new Date().toISOString(),
    };
    if (filiere) {
      const filiereInfo = await resolveFiliere(pool, filiere);
      updateData.filiere = filiereInfo.id || filiere;
      updateData.filiere_nom = filiereInfo.nom;
    }

    const updatedAnnonce = await AnnonceModel.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Annonce mise à jour avec succès.',
      data: updatedAnnonce,
    });
  } catch (error) {
    console.error('[updateAnnonce] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de l\'annonce.',
      error: error.message,
    });
  }
};

// DELETE /api/annonces/:id - Supprimer une annonce
exports.deleteAnnonce = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    // Vérifier que l'annonce existe
    const annonce = await AnnonceModel.findById(id);
    if (!annonce) {
      return res.status(404).json({
        success: false,
        message: 'Annonce non trouvée.',
      });
    }

    // Vérifier les permissions
    if (annonce.auteur !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Seul l\'auteur ou un admin peut supprimer cette annonce.',
      });
    }

    await AnnonceModel.delete(id);

    res.status(200).json({
      success: true,
      message: 'Annonce supprimée avec succès.',
    });
  } catch (error) {
    console.error('[deleteAnnonce] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'annonce.',
      error: error.message,
    });
  }
};

// PATCH /api/annonces/:id/publier - Publier une annonce
exports.publishAnnonce = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    // Vérifier que l'annonce existe
    const annonce = await AnnonceModel.findById(id);
    if (!annonce) {
      return res.status(404).json({
        success: false,
        message: 'Annonce non trouvée.',
      });
    }

    // Vérifier les permissions
    if (annonce.auteur !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé.',
      });
    }

    // Vérifier que l'annonce est en brouillon
    if (annonce.statut === 'publie') {
      return res.status(400).json({
        success: false,
        message: 'Cette annonce est déjà publiée.',
      });
    }

    const publishedAnnonce = await AnnonceModel.publish(id);

    // Persister puis pousser la notification afin que le flux soit disponible
    // même pour les étudiants qui n'étaient pas connectés au moment du push.
    await notifierPublication(publishedAnnonce);

    res.status(200).json({
      success: true,
      message: 'Annonce publiée avec succès.',
      data: publishedAnnonce,
    });
  } catch (error) {
    console.error('[publishAnnonce] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la publication de l\'annonce.',
      error: error.message,
    });
  }
};

// POST /api/annonces/:id/fichier - Upload un fichier à une annonce
exports.uploadAnnonceFile = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.uploadedFileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier uploadé.',
      });
    }

    // Vérifier que l'annonce existe
    const annonce = await AnnonceModel.findById(id);
    if (!annonce) {
      return res.status(404).json({
        success: false,
        message: 'Annonce non trouvée.',
      });
    }

    // Ajouter le fichier
    const updatedAnnonce = await AnnonceModel.addFile(id, req.uploadedFileUrl);

    res.status(200).json({
      success: true,
      message: 'Fichier uploadé avec succès.',
      url: req.uploadedFileUrl,
      data: updatedAnnonce,
    });
  } catch (error) {
    console.error('[uploadAnnonceFile] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'upload du fichier.',
      error: error.message,
    });
  }
};
