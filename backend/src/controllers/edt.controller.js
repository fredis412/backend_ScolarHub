const EdtModel = require('../models/edtModel');
const pool = require('../config/db');
const { resolveFiliere } = require('../utils/filieres');
const { envoyerNotificationAuto } = require('./notifications.controller');

/**
 * Contrôleur pour les Emplois Du Temps (EDT)
 */

// ── Multi-établissement ─────────────────────────────────────────────────────
// Un EDT appartient à un établissement par sa filière (filieres.etablissement_id).
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), aucun
// filtre n'est appliqué (comportement historique).
async function filieresDeMonEtab(etabId) {
  if (!etabId) return null; // pas de filtre
  const r = await pool.query('SELECT id FROM filieres WHERE etablissement_id = $1', [etabId]);
  return new Set(r.rows.map((x) => String(x.id)));
}
async function edtAutorise(req, edt) {
  const ids = await filieresDeMonEtab(req.etablissementId);
  return !ids || ids.has(String(edt.filiere));
}
// Résout une filière (id ou nom) DANS l'établissement du demandeur.
async function resoudreFiliereEtab(req, filiere) {
  if (!req.etablissementId) return resolveFiliere(pool, filiere);
  const r = await pool.query(
    'SELECT id, nom FROM filieres WHERE etablissement_id = $1 AND (CAST(id AS TEXT) = $2 OR LOWER(nom) = LOWER($2)) LIMIT 1',
    [req.etablissementId, String(filiere)]
  );
  return r.rows[0] || null;
}
const FILIERE_INTROUVABLE = { success: false, message: 'Filière inconnue pour votre établissement.' };

// Archive automatiquement les EDT dont la semaine est terminée (dateFin dépassée).
// Appelé à chaque lecture : pas besoin de tâche planifiée. Les EDT archivés
// n'apparaissent plus côté étudiants et passent dans l'onglet « Archivés » côté admin.
async function archiverExpires() {
  try {
    const actifs = await EdtModel.findAll({ limit: 1000, offset: 0, includeArchives: false });
    const aujourdhui = new Date().toISOString().slice(0, 10);
    for (const e of actifs || []) {
      if (e.archive || !e.dateFin) continue;
      if (String(e.dateFin).slice(0, 10) < aujourdhui) {
        await EdtModel.archive(e.id);
      }
    }
  } catch (err) {
    console.error('[archiverExpires] Erreur :', err.message);
  }
}

// GET /api/edt - Récupérer l'EDT de l'étudiant connecté
exports.getStudentEdt = async (req, res) => {
  try {
    await archiverExpires();
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

// GET /api/edt/mon-programme — Programme actif + historique de l'étudiant connecté.
// La filière et le niveau viennent de la fiche étudiant (etudiants.filiere_id),
// DANS l'établissement du jeton : un étudiant ne voit jamais l'EDT d'un autre
// établissement, même si une filière y porte le même nom.
exports.getMonProgramme = async (req, res) => {
  try {
    const params = [req.user.id];
    let etabSql = '';
    if (req.etablissementId) {
      params.push(req.etablissementId);
      etabSql = ` AND f.etablissement_id = $${params.length}`;
    }
    const etu = await pool.query(
      `SELECT e.filiere_id, e.niveau, f.nom AS filiere_nom, f.domaine
         FROM etudiants e JOIN filieres f ON f.id = e.filiere_id
        WHERE e.user_id = $1${etabSql}
        LIMIT 1`,
      params
    );
    const fiche = etu.rows[0];
    if (!fiche) {
      return res.json({ success: true, data: { filiere: {}, actif: null, historique: [] } });
    }

    const r = await pool.query(
      `SELECT * FROM edt WHERE CAST(filiere AS TEXT) = $1 AND niveau = $2`,
      [String(fiche.filiere_id), fiche.niveau]
    );
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const jour = (v) => (v ? String(v).slice(0, 10) : null);
    const lignes = r.rows || [];

    const nonArchives = lignes.filter((e) => !e.archive);
    // Semaine en cours d'abord ; sinon le plus récent non archivé (anciens EDT sans dates).
    let actif = nonArchives
      .filter((e) => jour(e.dateDebut) && jour(e.dateFin) && jour(e.dateDebut) <= aujourdhui && aujourdhui <= jour(e.dateFin))
      .sort((a, b) => String(jour(b.dateDebut)).localeCompare(String(jour(a.dateDebut))))[0];
    if (!actif) {
      actif = nonArchives
        .filter((e) => !jour(e.dateFin) || jour(e.dateFin) >= aujourdhui)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
    }
    const historique = lignes
      .filter((e) => e.archive || (jour(e.dateFin) && jour(e.dateFin) < aujourdhui))
      .sort((a, b) => String(jour(b.dateFin) || '').localeCompare(String(jour(a.dateFin) || '')));

    res.json({
      success: true,
      data: {
        filiere: { id: fiche.filiere_id, nom: fiche.filiere_nom, domaine: fiche.domaine || '' },
        niveau: fiche.niveau,
        actif: actif || null,
        historique,
      },
    });
  } catch (error) {
    console.error('[getMonProgramme] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération du programme.' });
  }
};

// GET /api/edt/admin - Récupérer tous les EDT (admin seulement)
exports.getAllEdt = async (req, res) => {
  try {
    await archiverExpires();
    const { filiere, niveau, anneeAcademique, includeArchives = false, limit = 50, offset = 0 } = req.query;

    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      includeArchives: includeArchives === 'true',
    };

    if (filiere) filters.filiere = filiere;
    if (niveau) filters.niveau = niveau;
    if (anneeAcademique) filters.anneeAcademique = anneeAcademique;

    let edts = await EdtModel.findAll(filters);
    const idsEtab = await filieresDeMonEtab(req.etablissementId);
    if (idsEtab) edts = (edts || []).filter((e) => idsEtab.has(String(e.filiere)));

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

    if (!edt || !(await edtAutorise(req, edt))) {
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

    const filiereInfo = await resoudreFiliereEtab(req, filiere);
    if (!filiereInfo) return res.status(403).json(FILIERE_INTROUVABLE);

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
    const { filiere, niveau, anneeAcademique, creneaux, dateDebut, dateFin } = req.body;

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

    const filiereInfo = await resoudreFiliereEtab(req, filiere);
    if (!filiereInfo) return res.status(403).json(FILIERE_INTROUVABLE);

    const edtData = {
      filiere: filiereInfo.id || filiere,
      filiere_nom: filiereInfo.nom,
      niveau,
      anneeAcademique: anneeAcademique || new Date().getFullYear().toString(),
      pdfUrl: null,
      creneaux,
      dateDebut: dateDebut || null,
      dateFin: dateFin || null,
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
    const { niveau, anneeAcademique, creneaux, archive, dateDebut, dateFin } = req.body;

    const edt = await EdtModel.findById(id);
    if (!edt || !(await edtAutorise(req, edt))) {
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
      ...(dateDebut !== undefined && { dateDebut }),
      ...(dateFin !== undefined && { dateFin }),
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
    if (!edt || !(await edtAutorise(req, edt))) {
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
      const filiereInfo = await resoudreFiliereEtab(req, filiere);
      if (!filiereInfo) return res.status(403).json(FILIERE_INTROUVABLE);
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
    if (!edt || !(await edtAutorise(req, edt))) {
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
    if (!edt || !(await edtAutorise(req, edt))) {
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
    if (!edt || !(await edtAutorise(req, edt))) {
      return res.status(404).json({ success: false, message: 'Emploi du temps introuvable.' });
    }

    const filiereId = edt.filiere;      // id de filière stocké dans l'EDT
    const niveau = edt.niveau || null;  // ex. "Licence 2"

    // ⚠️ Bug récurrent sur ce projet : `filiere_id` et `niveau` n'existent
    // QUE sur `etudiants`, jamais sur `users` — ne JAMAIS écrire
    // `u.filiere_id` ou `u.niveau` dans une requête (déjà rencontré et
    // corrigé dans etudiants.controller.js::listEtudiants, notes.controller.js
    // et ailleurs). D'où le JOIN (pas LEFT) : un étudiant sans ligne
    // `etudiants` ne peut de toute façon pas être rattaché à une filière.
    const pEnv = [filiereId, niveau];
    let etabEnv = '';
    if (req.etablissementId) {
      pEnv.push(req.etablissementId);
      etabEnv = ` AND u.etablissement_id = $${pEnv.length}`;
    }
    const r = await pool.query(
      `SELECT u.id, u.prenoms, u.nom
         FROM users u
         JOIN etudiants e ON u.id = e.user_id
        WHERE e.filiere_id = $1
          AND ($2::text IS NULL OR e.niveau = $2)
          AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%')
          AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye')${etabEnv}`,
      pEnv
    );
    const etudiants = r.rows;

    const titre = 'Nouvel emploi du temps';
    const corps =
      `Votre emploi du temps${edt.filiere_nom ? ' — ' + edt.filiere_nom : ''}` +
      `${niveau ? ' (' + niveau + ')' : ''} est disponible.`;

    let notifies = 0;
    for (const etu of etudiants) {
      // type/data → au clic côté Flutter, ouvre directement l'onglet Planning.
      const rr = await envoyerNotificationAuto(etu.id, titre, corps, 'edt', { tab: 'planning' });
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