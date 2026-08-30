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

    if (newAnnonce && (newAnnonce.statut === 'publie' || annonceData.statut === 'publie')) {
      syncAnnonceToCanalAndNotify(newAnnonce || annonceData, req.app);
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

async function syncAnnonceToCanalAndNotify(annonce, app) {
  try {
    const io = app?.get('io');
    let extra = '';
    if (annonce.filiere_nom) extra += `\n\n📍 Filière : ${annonce.filiere_nom}`;
    if (annonce.niveau) extra += `\n🎓 Niveau : ${annonce.niveau}`;

    const messageContenu = `📢 **${annonce.titre}**\n\n${annonce.contenu}${extra}`;

    let authorName = { nom: 'IST', prenoms: 'Administration' };
    if (annonce.auteur) {
      try {
        const { rows } = await pool.query('SELECT nom, prenoms FROM users WHERE id = $1', [annonce.auteur]);
        if (rows[0]) authorName = rows[0];
      } catch (_) {}
    }

    const socketMsg = {
      id: 'ann_' + annonce.id,
      canal_id: 1,
      canalId: 1,
      auteur_id: annonce.auteur,
      prenoms: authorName.prenoms || 'Administration',
      nom: authorName.nom || 'IST',
      contenu: messageContenu,
      type: 'annonce',
      created_at: new Date().toISOString(),
      reactions: []
    };

    // 1. Récupérer les étudiants ciblés
    try {
      let notifQuery = `
        SELECT u.id, u.filiere_nom, u.niveau, e.filiere_id as e_fid, e.filiere_nom as e_fnom, e.niveau as e_niv
        FROM users u
        LEFT JOIN etudiants e ON e.user_id = u.id
        WHERE LOWER(COALESCE(u.role, 'etudiant')) IN ('etudiant', 'delegue', 'delegue_adjoint')
      `;
      const notifParams = [];
      if (annonce.filiere) {
        notifParams.push(annonce.filiere);
        // Matcher: table etudiants (filiere_id), ou user.filiere_nom via acronyme ou nom complet
        notifQuery += ` AND (
          e.filiere_id = $${notifParams.length}
          OR u.filiere_nom ILIKE (SELECT nom FROM filieres WHERE id = $${notifParams.length})
          OR (u.filiere_nom = 'RIT' AND $${notifParams.length}::int = 1)
          OR (u.filiere_nom = 'ELT' AND $${notifParams.length}::int = 2)
          OR (u.filiere_nom = 'MC'  AND $${notifParams.length}::int = 3)
          OR (u.filiere_nom = 'GCF' AND $${notifParams.length}::int = 4)
          OR (u.filiere_nom = 'GC'  AND $${notifParams.length}::int = 5)
          OR (u.filiere_nom = 'FC'  AND $${notifParams.length}::int = 6)
        )`;
      }
      if (annonce.niveau) {
        notifParams.push(annonce.niveau);
        notifQuery += ` AND (
          e.niveau = $${notifParams.length}
          OR u.niveau = $${notifParams.length}
          OR (u.niveau = 'L1' AND $${notifParams.length} = 'Licence 1')
          OR (u.niveau = 'L2' AND $${notifParams.length} = 'Licence 2')
          OR (u.niveau = 'L3' AND $${notifParams.length} = 'Licence 3')
          OR (u.niveau = 'M1' AND $${notifParams.length} = 'Master 1')
          OR (u.niveau = 'M2' AND $${notifParams.length} = 'Master 2')
        )`;
      }
      const { rows: students } = await pool.query(notifQuery, notifParams);

      if (io) {
        if (!annonce.filiere && !annonce.niveau) {
          // Annonce globale : diffuser à tout le canal
          io.to('canal:1').emit('message:canal', socketMsg);
        } else {
          // Annonce ciblée : diffuser uniquement aux étudiants concernés
          for (const s of students) {
            io.to(`user:${s.id}`).emit('message:canal', socketMsg);
          }
          if (annonce.filiere) {
            io.to(`filiere:${annonce.filiere}`).emit('message:canal', socketMsg);
            io.to('canal:2').emit('message:canal', { ...socketMsg, canal_id: 2, canalId: 2 });
          }
        }

        // Envoyer les notifications
        for (const s of students) {
          pool.query(
            `INSERT INTO notifications (user_id, titre, corps, created_at) VALUES ($1, $2, $3, NOW())`,
            [s.id, `Annonce : ${annonce.titre}`, annonce.contenu]
          ).catch(() => {});

          io.to(`user:${s.id}`).emit('notification', {
            titre: `Annonce : ${annonce.titre}`,
            corps: annonce.contenu,
            created_at: new Date().toISOString(),
          });
        }
      }
    } catch (notifErr) {
      console.warn('[syncAnnonce] Erreur notification/socket ciblé:', notifErr.message);
    }
  } catch (err) {
    console.error('[syncAnnonceToCanalAndNotify] Erreur :', err);
  }
}

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

    if (updatedAnnonce && (updatedAnnonce.statut === 'publie' || updateData.statut === 'publie')) {
      syncAnnonceToCanalAndNotify(updatedAnnonce || { ...annonce, ...updateData }, req.app);
    }

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

    syncAnnonceToCanalAndNotify(publishedAnnonce || { ...annonce, statut: 'publie' }, req.app);
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
