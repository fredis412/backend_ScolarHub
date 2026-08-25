const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/modules - Liste de tous les modules
router.get('/', async (req, res) => {
  try {
    const { filiere_id } = req.query;
    let query = `
      SELECT m.id, m.nom, m.coefficient, m.volume_horaire, m.filiere_id, m.filiere_nom,
             f.nom AS filiere,
             (SELECT CONCAT(u2.prenoms, ' ', u2.nom)
              FROM module_professeur mp
              JOIN professeurs p ON p.id = mp.professeur_id
              JOIN users u2 ON u2.id = p.user_id
              WHERE mp.module_id = m.id
              LIMIT 1) AS professeur
      FROM modules m
      LEFT JOIN filieres f ON f.id = m.filiere_id
    `;
    const params = [];
    if (filiere_id) {
      query += ' WHERE m.filiere_id = $1';
      params.push(filiere_id);
    }
    query += ' ORDER BY m.nom';
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[modules] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur chargement modules.' });
  }
});

// GET /api/modules/:id - Detaille d'un module
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, f.nom AS filiere
       FROM modules m LEFT JOIN filieres f ON f.id = m.filiere_id
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Module non trouve.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[modules] GET /:id', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// POST /api/modules - Creer un module (admin ou professeur)
router.post('/', authMiddleware, requireRole('admin', 'professeur'), async (req, res) => {
  try {
    const { nom, coefficient, volume_horaire, filiere_id, filiere_nom, professeur_user_id } = req.body;
    if (!nom?.trim()) {
      return res.status(400).json({ success: false, message: 'Nom du module requis.' });
    }
    const result = await pool.query(
      `INSERT INTO modules (nom, coefficient, volume_horaire, filiere_id, filiere_nom)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nom.trim(), coefficient || 1, volume_horaire || null, filiere_id || null, filiere_nom || null]
    );

    // Assure l'existence de la fiche professeurs(user_id) et lie le module.
    async function assignerProf(userId) {
      let prof = await pool.query('SELECT id FROM professeurs WHERE user_id = $1', [userId]);
      if (!prof.rows[0]) {
        prof = await pool.query('INSERT INTO professeurs (user_id) VALUES ($1) RETURNING id', [userId]);
      }
      await pool.query(
        'INSERT INTO module_professeur (module_id, professeur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [result.rows[0].id, prof.rows[0].id]
      );
    }

    let professeurNom = null;
    if (req.user.role === 'professeur') {
      // Un professeur qui cree un module se le voit assigner automatiquement.
      await assignerProf(req.user.id);
    } else if (professeur_user_id) {
      // L'admin attribue le module a un professeur des la creation.
      const u = await pool.query(
        `SELECT id, CONCAT(prenoms, ' ', nom) AS nom_complet FROM users WHERE id = $1 AND role = 'professeur'`,
        [professeur_user_id]
      );
      if (!u.rows[0]) {
        return res.status(400).json({ success: false, message: 'Professeur introuvable.' });
      }
      await assignerProf(professeur_user_id);
      professeurNom = u.rows[0].nom_complet;
    }

    res.status(201).json({ success: true, data: { ...result.rows[0], professeur: professeurNom } });
  } catch (err) {
    console.error('[modules] POST /', err);
    res.status(500).json({ success: false, message: 'Erreur creation module.' });
  }
});

// PUT /api/modules/:id - Modifier un module (admin)
router.put('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { nom, coefficient, volume_horaire, filiere_id, filiere_nom } = req.body;
    const result = await pool.query(
      `UPDATE modules SET nom = COALESCE($1, nom), coefficient = COALESCE($2, coefficient),
       volume_horaire = COALESCE($3, volume_horaire), filiere_id = COALESCE($4, filiere_id),
       filiere_nom = COALESCE($5, filiere_nom)
       WHERE id = $6 RETURNING *`,
      [nom, coefficient, volume_horaire, filiere_id, filiere_nom, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Module non trouve.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[modules] PUT /:id', err);
    res.status(500).json({ success: false, message: 'Erreur modification module.' });
  }
});

// DELETE /api/modules/:id - Supprimer un module (admin)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM modules WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Module non trouve.' });
    }
    res.json({ success: true, message: 'Module supprime.' });
  } catch (err) {
    console.error('[modules] DELETE /:id', err);
    res.status(500).json({ success: false, message: 'Erreur suppression module.' });
  }
});

module.exports = router;
