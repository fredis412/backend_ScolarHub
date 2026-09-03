const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const parentsController = require('../controllers/parents.controller');

// GET /api/parents - Liste des parents avec leurs enfants
router.get('/', authMiddleware, requireRole('admin', 'direction'), parentsController.getParents);

// POST /api/parents - Créer un parent
router.post('/', authMiddleware, requireRole('admin', 'direction'), parentsController.createParent);

// GET /api/parents/mon-enfant - Informations de l'enfant pour le parent connecté
router.get('/mon-enfant', authMiddleware, async (req, res) => {
  try {
    const parentUserId = req.user.id;
    const r = await pool.query(
      `SELECT e.id AS etudiant_id, e.matricule, e.nom, e.prenoms, e.filiere_nom, e.niveau, e.domaine, e.email, e.tel,
              p.relation, p.statut_compte
       FROM users u
       LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.telephone, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
       LEFT JOIN etudiants e ON (e.matricule = p.matricule_enfant OR e.id = p.etudiant_id OR REPLACE(COALESCE(e.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '') OR e.matricule = u.matricule)
       WHERE u.id::text = $1 AND e.id IS NOT NULL
       LIMIT 1`,
      [parentUserId.toString()]
    );

    if (!r.rows[0]) {
      return res.status(404).json({ success: false, message: 'Aucun enfant rattache trouve.' });
    }

    const etu = r.rows[0];
    const nomComplet = `${etu.prenoms || ''} ${etu.nom || ''}`.trim();

    res.json({
      success: true,
      data: {
        etudiantId: etu.etudiant_id,
        matricule: etu.matricule,
        nom: etu.nom,
        prenoms: etu.prenoms,
        nomComplet: nomComplet,
        filiere: etu.filiere_nom || '',
        niveau: etu.niveau || '',
        domaine: etu.domaine || '',
        relation: etu.relation || 'Parent',
      }
    });
  } catch (err) {
    console.error('[parents] GET /mon-enfant', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// GET /api/parents/enfant/:etudiantId - Info parent pour un etudiant
router.get('/enfant/:etudiantId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT nom_parent, tel_parent, email_parent FROM etudiants WHERE id = $1`,
      [req.params.etudiantId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Etudiant non trouve.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[parents] GET /enfant/:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// PUT /api/parents/enfant/:etudiantId - Mettre a jour info parent
router.put('/enfant/:etudiantId', authMiddleware, async (req, res) => {
  try {
    const { nom_parent, tel_parent, email_parent } = req.body;
    const result = await pool.query(
      `UPDATE etudiants SET nom_parent = COALESCE($1, nom_parent),
       tel_parent = COALESCE($2, tel_parent), email_parent = COALESCE($3, email_parent)
       WHERE id = $4 RETURNING nom_parent, tel_parent, email_parent`,
      [nom_parent, tel_parent, email_parent, req.params.etudiantId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Etudiant non trouve.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[parents] PUT /enfant/:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// GET /api/parents/enfant/:etudiantId/notes - Notes de l'enfant
router.get('/enfant/:etudiantId/notes', authMiddleware, async (req, res) => {
  try {
    const { etudiantId } = req.params;
    const result = await pool.query(
      `SELECT * FROM vue_notes_etudiants WHERE etudiant_id = $1 ORDER BY date_session DESC`,
      [etudiantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[parents] GET /enfant/:id/notes', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// GET /api/parents/enfant/:etudiantId/presences - Présences de l'enfant
router.get('/enfant/:etudiantId/presences', authMiddleware, async (req, res) => {
  try {
    const { etudiantId } = req.params;
    const result = await pool.query(
      `SELECT * FROM vue_presences_etudiants WHERE etudiant_id = $1 ORDER BY date_appel DESC`,
      [etudiantId]
    );

    const total = result.rows.length;
    const presentes = result.rows.filter(r => r.presence_statut === 'present').length;
    const absentes = result.rows.filter(r => r.presence_statut === 'absent').length;
    const retards = result.rows.filter(r => r.presence_statut === 'retard').length;

    res.json({
      success: true,
      data: result.rows,
      stats: { total, presentes, absentes, retards }
    });
  } catch (err) {
    console.error('[parents] GET /enfant/:id/presences', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;
