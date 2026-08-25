const EdtModel = require('../models/edtModel');
const pool = require('../config/db');
const { resolveFiliere } = require('../utils/filieres');
const { envoyerNotificationAuto } = require('./notifications.controller');

/**
 * Contrôleur pour les Emplois Du Temps (EDT)
 */

// GET /api/edt - Récupérer l'EDT de l'étudiant connecté
exports.getStudentEdt = async (req, res) => {
  try {
    const userFiliere = req.user?.filiere_id;
    const userNiveau = req.user?.niveau; // À vérifier selon votre schéma

    if (!userFiliere) {
      return res.status(400).json({
        success: false,
        message: 'Filière non définie pour cet utilisateur.',
      });
    }

    const edt = await EdtModel.findByFilierAndNiveau(userFiliere, userNiveau);

    if (!edt) {
      return res.status(404).json({
        success: false,
        message: 'Aucun emploi du temps trouvé pour votre filière et niveau.',
      });
    }

    res.status(200).json({
      success: true,
      data: edt,
    });
  } catch (error) {
    console.error('[getStudentEdt] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'EDT.',
      error: error.message,
    });
  }
};

// GET /api/edt/admin - Récupérer tous les EDT (admin seulement)
exports.getAllEdt = async (req, res) => {
  try {
    const { filiere, niveau, anneeAcademique, includeArchives = false, limit = 50, offset = 0 } = req.query;

    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      includeArchives: includeArchives === 'true',
    };

    if (filiere) filters.filiere = filiere;
    if (niveau) filters.niveau = niveau;
    if (anneeAcademique) filters.anneeAcademique = anneeAcademique;

    const edts = await EdtModel.findAll(filters);

    res.status(200).json({
      success: true,
      count: edts.length,
      data: edts,
    });
  } catch (error) {
    console.error('[getAllEdt] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des EDT.',
      error: error.message,
    });
  }
};

// GET /api/edt/:id - Récupérer un EDT spécifique
exports.getEdtById = async (req, res) => {
  try {
    const { id } = req.params;

    const edt = await EdtModel.findById(id);

    if (!edt) {
      return res.status(404).json({
        success: false,
        message: 'EDT non trouvé.',
      });
    }

    res.status(200).json({
      success: true,
      data: edt,
    });
  } catch (error) {
    console.error('[getEdtById] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'EDT.',
      error: error.message,
    });
  }
};

// POST /api/edt - Créer/Uploader un nouvel EDT
exports.createEdt = async (req, res) => {
  try {
    const { filiere, niveau, anneeAcademique } = req.body;

    if (!req.uploadedFileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Un fichier PDF est requis.',
      });
    }

    if (!filiere || !niveau) {
      return res.status(400).json({
        success: false,
        message: 'Filière, niveau et année académique sont obligatoires.',
      });
    }

    const filiereInfo = await resolveFiliere(pool, filiere);

    const edtData = {
      filiere: filiereInfo.id || filiere,
      filiere_nom: filiereInfo.nom,
      niveau,
      anneeAcademique: anneeAcademique || new Date().getFullYear().toString(),
      pdfUrl: req.uploadedFileUrl,
      archive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newEdt = await EdtModel.create(edtData);

    res.status(201).json({
      success: true,
      message: 'Emploi du temps créé avec succès.',
      data: newEdt,
    });
  } catch (error) {
    console.error('[createEdt] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'EDT.',
      error: error.message,
    });
  }
};

// POST /api/edt/grille - Créer un EDT au format grille (jours/heures/salle), sans fichier PDF
exports.createEdtGrille = async (req, res) => {
  try {
    const { filiere, niveau, anneeAcademique, creneaux } = req.body;

    if (!filiere || !niveau) {
      return res.status(400).json({
        success: false,
        message: 'Filière et niveau sont obligatoires.',
      });
    }

    if (!Array.isArray(creneaux) || creneaux.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Au moins un créneau est requis.',
      });
    }

    const filiereInfo = await resolveFiliere(pool, filiere);

    const edtData = {
      filiere: filiereInfo.id || filiere,
      filiere_nom: filiereInfo.nom,
      niveau,
      anneeAcademique: anneeAcademique || new Date().getFullYear().toString(),
      pdfUrl: null,
      creneaux,
      archive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newEdt = await EdtModel.create(edtData);

    res.status(201).json({
      success: true,
      message: 'Emploi du temps créé avec succès.',
      data: newEdt,
    });
  } catch (error) {
    console.error('[createEdtGrille] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'EDT.',
      error: error.message,
    });
  }
};

// PUT /api/edt/grille/:id - Modifier les créneaux d'un EDT existant
exports.updateEdtGrille = async (req, res) => {
  try {
    const { id } = req.params;
    const { niveau, anneeAcademique, creneaux, archive } = req.body;

    const edt = await EdtModel.findById(id);
    if (!edt) {
      return res.status(404).json({
        success: false,
        message: 'EDT non trouvé.',
      });
    }

    const updateData = {
      ...(niveau && { niveau }),
      ...(anneeAcademique && { anneeAcademique }),
      ...(Array.isArray(creneaux) && { creneaux }),
      ...(typeof archive === 'boolean' && { archive }),
      updatedAt: new Date().toISOString(),
    };

    const updatedEdt = await EdtModel.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'EDT mis à jour avec succès.',
      data: updatedEdt,
    });
  } catch (error) {
    console.error('[updateEdtGrille] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de l\'EDT.',
      error: error.message,
    });
  }
};

// PUT /api/edt/:id - Mettre à jour un EDT
exports.updateEdt = async (req, res) => {
  try {
    const { id } = req.params;
    const { filiere, niveau, anneeAcademique } = req.body;

    // Vérifier que l'EDT existe
    const edt = await EdtModel.findById(id);
    if (!edt) {
      return res.status(404).json({
        success: false,
        message: 'EDT non trouvé.',
      });
    }

    const updateData = {
      ...(niveau && { niveau }),
      ...(anneeAcademique && { anneeAcademique }),
      ...(req.uploadedFileUrl && { pdfUrl: req.uploadedFileUrl }),
      updatedAt: new Date().toISOString(),
    };
    if (filiere) {
      const filiereInfo = await resolveFiliere(pool, filiere);
      updateData.filiere = filiereInfo.id || filiere;
      updateData.filiere_nom = filiereInfo.nom;
    }

    const updatedEdt = await EdtModel.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'EDT mis à jour avec succès.',
      data: updatedEdt,
    });
  } catch (error) {
    console.error('[updateEdt] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de l\'EDT.',
      error: error.message,
    });
  }
};

// PATCH /api/edt/:id/archiver - Archiver un EDT
exports.archiveEdt = async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que l'EDT existe
    const edt = await EdtModel.findById(id);
    if (!edt) {
      return res.status(404).json({
        success: false,
        message: 'EDT non trouvé.',
      });
    }

    // Vérifier qu'il n'est pas déjà archivé
    if (edt.archive) {
      return res.status(400).json({
        success: false,
        message: 'Cet EDT est déjà archivé.',
      });
    }

    const archivedEdt = await EdtModel.archive(id);

    res.status(200).json({
      success: true,
      message: 'EDT archivé avec succès.',
      data: archivedEdt,
    });
  } catch (error) {
    console.error('[archiveEdt] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'archivage de l\'EDT.',
      error: error.message,
    });
  }
};

// DELETE /api/edt/:id - Supprimer un EDT
exports.deleteEdt = async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que l'EDT existe
    const edt = await EdtModel.findById(id);
    if (!edt) {
      return res.status(404).json({
        success: false,
        message: 'EDT non trouvé.',
      });
    }

    await EdtModel.delete(id);

    res.status(200).json({
      success: true,
      message: 'EDT supprimé avec succès.',
    });
  } catch (error) {
    console.error('[deleteEdt] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'EDT.',
      error: error.message,
    });
  }
};

// POST /api/edt/:id/envoyer - Notifier les étudiants de la filière + niveau de
// cet EDT qu'un nouvel emploi du temps est disponible.
exports.envoyerEdt = async (req, res) => {
  try {
    const { id } = req.params;
    const edt = await EdtModel.findById(id);
    if (!edt) {
      return res.status(404).json({ success: false, message: 'Emploi du temps introuvable.' });
    }

    const filiereId = edt.filiere;      // id de filière stocké dans l'EDT
    const niveau = edt.niveau || null;  // ex. "Licence 2"

    // Étudiants actifs de cette filière (et de ce niveau si renseigné).
    const r = await pool.query(
      `SELECT u.id, u.prenoms, u.nom
         FROM etudiants e
         JOIN users u ON u.id = e.user_id
        WHERE e.filiere_id = $1
          AND ($2::text IS NULL OR e.niveau = $2 OR u.niveau = $2)
          AND u.role = 'etudiant'
          AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye')`,
      [filiereId, niveau]
    );
    const etudiants = r.rows;

    const titre = 'Nouvel emploi du temps';
    const corps =
      `Votre emploi du temps${edt.filiere_nom ? ' — ' + edt.filiere_nom : ''}` +
      `${niveau ? ' (' + niveau + ')' : ''} est disponible.`;

    let notifies = 0;
    for (const etu of etudiants) {
      const rr = await envoyerNotificationAuto(etu.id, titre, corps);
      if (rr.success) notifies += 1;
    }

    return res.status(200).json({
      success: true,
      total: etudiants.length,
      notifies,
      message: etudiants.length === 0
        ? 'Aucun étudiant trouvé pour cette filière et ce niveau.'
        : `Emploi du temps envoyé à ${notifies} étudiant(s).`,
    });
  } catch (error) {
    console.error('[envoyerEdt] Erreur :', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
