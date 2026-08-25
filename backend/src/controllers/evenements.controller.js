const pool = require('../config/db');

/**
 * Contrôleur pour les Événements (BDE / administration)
 * Un étudiant ou un admin peut créer un événement ; les étudiants
 * s'y inscrivent via une fiche d'inscription (evenement_inscriptions).
 */

const STATUTS = ['en_attente', 'approuve', 'annule'];

// GET /api/evenements - Liste des événements avec le nombre d'inscrits
exports.getAllEvenements = async (req, res) => {
  try {
    const { statut, limit = 50, offset = 0 } = req.query;
    const params = [];
    let where = '';
    if (statut && STATUTS.includes(statut)) {
      params.push(statut);
      where = `WHERE e.statut = $${params.length}`;
    }
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(
      `
      SELECT e.*, u.nom AS auteur_nom, u.prenoms AS auteur_prenoms,
             COUNT(i.id)::int AS inscrits
      FROM evenements e
      LEFT JOIN users u ON u.id = e.auteur
      LEFT JOIN evenement_inscriptions i ON i.evenement_id = e.id
      ${where}
      GROUP BY e.id, u.nom, u.prenoms
      ORDER BY e.date_debut ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );

    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error('[getAllEvenements] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des événements.' });
  }
};

// GET /api/evenements/:id
exports.getEvenementById = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT e.*, COUNT(i.id)::int AS inscrits
      FROM evenements e
      LEFT JOIN evenement_inscriptions i ON i.evenement_id = e.id
      WHERE e.id = $1
      GROUP BY e.id
      `,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[getEvenementById] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération de l\'événement.' });
  }
};

// POST /api/evenements - Créer un événement (étudiant, professeur ou admin)
exports.createEvenement = async (req, res) => {
  try {
    const { titre, description, lieu, dateDebut, prix, capacite } = req.body;
    if (!titre || !dateDebut) {
      return res.status(400).json({ success: false, message: 'Titre et date de l\'événement sont obligatoires.' });
    }

    // Les événements créés par l'admin sont approuvés d'office,
    // ceux des étudiants restent en attente de validation.
    const statut = req.user.role === 'admin' ? 'approuve' : 'en_attente';

    const result = await pool.query(
      `
      INSERT INTO evenements (titre, description, lieu, date_debut, prix, capacite, statut, auteur)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        titre,
        description || null,
        lieu || null,
        dateDebut,
        parseFloat(prix) || 0,
        parseInt(capacite) || 0,
        statut,
        req.user.id,
      ]
    );

    res.status(201).json({ success: true, message: 'Événement créé avec succès.', data: result.rows[0] });
  } catch (error) {
    console.error('[createEvenement] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la création de l\'événement.' });
  }
};

// PATCH /api/evenements/:id/statut - Approuver / annuler (admin uniquement)
exports.updateStatut = async (req, res) => {
  try {
    const { statut } = req.body;
    if (!STATUTS.includes(statut)) {
      return res.status(400).json({ success: false, message: `Statut invalide. Valeurs autorisées : ${STATUTS.join(', ')}.` });
    }
    const result = await pool.query(
      `UPDATE evenements SET statut = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *`,
      [statut, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
    }
    res.json({ success: true, message: 'Statut mis à jour.', data: result.rows[0] });
  } catch (error) {
    console.error('[updateStatut] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du statut.' });
  }
};

// DELETE /api/evenements/:id - Auteur ou admin
exports.deleteEvenement = async (req, res) => {
  try {
    const existing = await pool.query('SELECT auteur FROM evenements WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
    }
    if (existing.rows[0].auteur !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé. Seul l\'auteur ou un admin peut supprimer cet événement.' });
    }
    await pool.query('DELETE FROM evenements WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Événement supprimé avec succès.' });
  } catch (error) {
    console.error('[deleteEvenement] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression de l\'événement.' });
  }
};

// POST /api/evenements/:id/affiche - Upload de l'affiche (Cloudinary)
exports.uploadAffiche = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    }
    const result = await pool.query(
      `UPDATE evenements SET affiche_url = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *`,
      [req.uploadedFileUrl, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
    }
    res.json({ success: true, message: 'Affiche uploadée avec succès.', url: req.uploadedFileUrl, data: result.rows[0] });
  } catch (error) {
    console.error('[uploadAffiche] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'upload de l\'affiche.' });
  }
};

// POST /api/evenements/:id/inscriptions - Fiche d'inscription à un événement
exports.inscrire = async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, prenoms, email, telephone, matricule } = req.body;

    if (!nom) {
      return res.status(400).json({ success: false, message: 'Le nom est obligatoire sur la fiche d\'inscription.' });
    }

    const evtResult = await pool.query(
      `
      SELECT e.*, COUNT(i.id)::int AS inscrits
      FROM evenements e
      LEFT JOIN evenement_inscriptions i ON i.evenement_id = e.id
      WHERE e.id = $1
      GROUP BY e.id
      `,
      [id]
    );
    if (evtResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
    }
    const evenement = evtResult.rows[0];

    if (evenement.statut === 'annule') {
      return res.status(400).json({ success: false, message: 'Cet événement a été annulé.' });
    }
    if (evenement.capacite > 0 && evenement.inscrits >= evenement.capacite) {
      return res.status(400).json({ success: false, message: 'Événement complet : plus de places disponibles.' });
    }

    const result = await pool.query(
      `
      INSERT INTO evenement_inscriptions (evenement_id, user_id, nom, prenoms, email, telephone, matricule)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [id, req.user.id, nom, prenoms || null, email || null, telephone || null, matricule || null]
    );

    res.status(201).json({ success: true, message: 'Inscription enregistrée avec succès.', data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Vous êtes déjà inscrit à cet événement.' });
    }
    console.error('[inscrire] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'inscription à l\'événement.' });
  }
};

// GET /api/evenements/admin/inscriptions - Historique de toutes les inscriptions (admin)
exports.getAllInscriptions = async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await pool.query(
      `
      SELECT i.*, e.titre AS evenement_titre, e.date_debut, e.prix
      FROM evenement_inscriptions i
      JOIN evenements e ON e.id = i.evenement_id
      ORDER BY i."createdAt" DESC
      LIMIT $1 OFFSET $2
      `,
      [parseInt(limit), parseInt(offset)]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error('[getAllInscriptions] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération de l\'historique des inscriptions.' });
  }
};

// GET /api/evenements/:id/inscriptions - Liste des inscrits (auteur ou admin)
exports.getInscriptions = async (req, res) => {
  try {
    const { id } = req.params;
    const evt = await pool.query('SELECT auteur FROM evenements WHERE id = $1', [id]);
    if (evt.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
    }
    if (evt.rows[0].auteur !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé. Seul l\'auteur ou un admin peut voir les inscriptions.' });
    }
    const result = await pool.query(
      `SELECT * FROM evenement_inscriptions WHERE evenement_id = $1 ORDER BY "createdAt" ASC`,
      [id]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error('[getInscriptions] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des inscriptions.' });
  }
};
