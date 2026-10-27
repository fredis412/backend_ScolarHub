const AnnonceModel = require('../models/annonceModel');
const CloudinaryService = require('../services/cloudinary.service');
const pool = require('../config/db');
const { resolveFiliere } = require('../utils/filieres');
const { envoyerNotificationAuto } = require('./notifications.controller');
const { ensureCanauxStandard } = require('../utils/canauxStandard');

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
// La table annonces porte etablissement_id (AnnonceModel ne le gère pas : on le
// pose / on le contrôle ici, sans toucher au modèle).
async function annonceDeMonEtab(id, etabId) {
  if (!etabId) return true;
  const r = await pool.query('SELECT 1 FROM annonces WHERE id = $1 AND etablissement_id = $2', [id, etabId]);
  return r.rows.length > 0;
}
async function idsAnnoncesEtab(etabId) {
  const r = await pool.query('SELECT id FROM annonces WHERE etablissement_id = $1', [etabId]);
  return new Set(r.rows.map(x => String(x.id)));
}
// Résout la filière (id numérique, nom ou sigle) en restant dans l'établissement.
// Renvoie { id, nom } ou null si elle n'existe pas dans l'établissement.
async function resoudreFiliereEtab(filiere, etabId) {
  if (!filiere) return { id: null, nom: null };
  let info = null;
  try { info = await resolveFiliere(pool, filiere); } catch (_) {}
  if (!etabId) return info || { id: null, nom: null };
  if (info && info.id) {
    const ok = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [info.id, etabId]);
    if (ok.rows.length > 0) return info;
  }
  const txt = String(filiere).trim();
  if (/^\d+$/.test(txt)) {
    const r = await pool.query('SELECT id, nom FROM filieres WHERE id = $1 AND etablissement_id = $2', [txt, etabId]);
    if (r.rows[0]) return { id: r.rows[0].id, nom: r.rows[0].nom };
  }
  const r2 = await pool.query(
    'SELECT id, nom FROM filieres WHERE LOWER(nom) = LOWER($1) AND etablissement_id = $2 LIMIT 1', [txt, etabId]
  );
  if (r2.rows[0]) return { id: r2.rows[0].id, nom: r2.rows[0].nom };
  return null;
}

async function notifierPublication(annonce, etabId) {
  const roleCible = annonce.cibleRole === 'tous' ? null : annonce.cibleRole;
  // ⚠️ BUG CORRIGÉ — u.filiere_id n'existe pas sur `users` (seulement sur
  // `etudiants`), même bug récurrent que sur ce projet (EDT, listEtudiants,
  // envoyerEdt...). Cette requête plantait systématiquement dès qu'une
  // annonce ciblait une filière précise, et l'admin voyait une erreur 500
  // alors que l'annonce avait déjà été créée et synchronisée dans le canal
  // juste avant (voir syncAnnonceToCanalAndNotify, non affectée).
  const paramsDest = roleCible ? [roleCible, annonce.filiere || null] : [null, annonce.filiere || null];
  let filtreEtabDest = '';
  if (etabId) {
    paramsDest.push(etabId);
    filtreEtabDest = ` AND u.etablissement_id = $${paramsDest.length}`;
  }
  const { rows: destinataires } = await pool.query(
    `SELECT DISTINCT u.id
     FROM users u
     LEFT JOIN etudiants e ON e.user_id = u.id
     WHERE ($2::integer IS NULL OR e.filiere_id = $2)
     ${roleCible ? 'AND u.role = $1' : ''}${filtreEtabDest}`,
    paramsDest,
  );
  await Promise.all(destinataires.map(({ id }) =>
    envoyerNotificationAuto(id, annonce.titre, annonce.contenu, 'annonce', null),
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

    let annonces;
    if (req.etablissementId) {
      // Le modèle ne filtre pas par établissement : on récupère large, on filtre,
      // puis on applique la pagination.
      const ids = await idsAnnoncesEtab(req.etablissementId);
      const tout = await AnnonceModel.findAll({ ...filters, limit: 1000, offset: 0 });
      annonces = tout.filter(a => ids.has(String(a.id))).slice(filters.offset, filters.offset + filters.limit);
    } else {
      annonces = await AnnonceModel.findAll(filters);
    }

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

    const annonce = (await annonceDeMonEtab(id, req.etablissementId))
      ? await AnnonceModel.findById(id)
      : null;

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

    const filiereInfo = await resoudreFiliereEtab(filiere, req.etablissementId);
    if (!filiereInfo) {
      return res.status(400).json({ success: false, message: 'Filière introuvable dans votre établissement.' });
    }

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

    // Rattache l'annonce à l'établissement (le modèle ne gère pas cette colonne).
    if (req.etablissementId && newAnnonce && newAnnonce.id) {
      await pool.query('UPDATE annonces SET etablissement_id = $1 WHERE id = $2', [req.etablissementId, newAnnonce.id]);
    }

    if (newAnnonce && (newAnnonce.statut === 'publie' || annonceData.statut === 'publie')) {
      syncAnnonceToCanalAndNotify(newAnnonce || annonceData, req.app, req.etablissementId);
    }
    if (annonceData.statut === 'publie') {
      await notifierPublication(newAnnonce, req.etablissementId);
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

async function syncAnnonceToCanalAndNotify(annonce, app, etabId) {
  try {
    const io = app?.get('io');
    let extra = '';
    if (annonce.filiere_nom) extra += `\n\n📍 Filière : ${annonce.filiere_nom}`;
    if (annonce.niveau) extra += `\n🎓 Niveau : ${annonce.niveau}`;

    const messageContenu = `📢 **${annonce.titre}**\n\n${annonce.contenu}${extra}`;

    let authorName = { nom: '', prenoms: 'Administration' };
    if (annonce.auteur) {
      try {
        const { rows } = await pool.query('SELECT nom, prenoms FROM users WHERE id = $1', [annonce.auteur]);
        if (rows[0]) authorName = rows[0];
      } catch (_) {}
    }

    // Canal « Administration » de l'établissement (id réel, plus le 1 historique).
    let canalAdminId = 1;
    try { canalAdminId = (await ensureCanauxStandard(etabId || null)).administration || 1; } catch (_) {}

    const socketMsg = {
      id: 'ann_' + annonce.id,
      canal_id: canalAdminId,
      canalId: canalAdminId,
      auteur_id: annonce.auteur,
      prenoms: authorName.prenoms || 'Administration',
      nom: authorName.nom || '',
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
      if (etabId) {
        notifParams.push(etabId);
        notifQuery += ` AND u.etablissement_id = $${notifParams.length}`;
      }
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
        if (etabId) {
          // Multi-établissement : les salles canal:1 / canal:2 sont partagées entre
          // établissements — on diffuse donc uniquement aux utilisateurs de l'école.
          let cibles = students;
          if (!annonce.filiere && !annonce.niveau) {
            const tous = await pool.query('SELECT id FROM users WHERE etablissement_id = $1', [etabId]);
            cibles = tous.rows;
          }
          for (const s of cibles) {
            io.to(`user:${s.id}`).emit('message:canal', socketMsg);
          }
          if (annonce.filiere) {
            io.to(`filiere:${annonce.filiere}`).emit('message:canal', socketMsg);
          }
        } else if (!annonce.filiere && !annonce.niveau) {
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

    // Vérifier que l'annonce existe (dans mon établissement)
    const annonce = (await annonceDeMonEtab(id, req.etablissementId))
      ? await AnnonceModel.findById(id)
      : null;
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
      const filiereInfo = await resoudreFiliereEtab(filiere, req.etablissementId);
      if (!filiereInfo) {
        return res.status(400).json({ success: false, message: 'Filière introuvable dans votre établissement.' });
      }
      updateData.filiere = filiereInfo.id || filiere;
      updateData.filiere_nom = filiereInfo.nom;
    }

    const updatedAnnonce = await AnnonceModel.update(id, updateData);

    if (updatedAnnonce && (updatedAnnonce.statut === 'publie' || updateData.statut === 'publie')) {
      syncAnnonceToCanalAndNotify(updatedAnnonce || { ...annonce, ...updateData }, req.app, req.etablissementId);
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

    // Vérifier que l'annonce existe (dans mon établissement)
    const annonce = (await annonceDeMonEtab(id, req.etablissementId))
      ? await AnnonceModel.findById(id)
      : null;
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

    // Vérifier que l'annonce existe (dans mon établissement)
    const annonce = (await annonceDeMonEtab(id, req.etablissementId))
      ? await AnnonceModel.findById(id)
      : null;
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

    syncAnnonceToCanalAndNotify(publishedAnnonce || { ...annonce, statut: 'publie' }, req.app, req.etablissementId);
    // Persister puis pousser la notification afin que le flux soit disponible
    // même pour les étudiants qui n'étaient pas connectés au moment du push.
    await notifierPublication(publishedAnnonce, req.etablissementId);

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

    // Vérifier que l'annonce existe (dans mon établissement)
    const annonce = (await annonceDeMonEtab(id, req.etablissementId))
      ? await AnnonceModel.findById(id)
      : null;
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