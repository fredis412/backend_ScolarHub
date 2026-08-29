const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

router.get('/professeur-filieres', authMiddleware, async (req, res) => {
  const role = String(req.user.role || '').toLowerCase().trim();
  if (!['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Accès réservé aux professeurs.' });
  }
  try {
    const filieres = await pool.query('SELECT id, nom, description FROM filieres ORDER BY nom');
    const result = [];
    for (const filiere of filieres.rows) {
      const type = `prof_delegues:${filiere.id}`;
      const existing = await pool.query('SELECT id FROM canaux WHERE type = $1 LIMIT 1', [type]);
      let canalId = existing.rows[0]?.id;
      if (!canalId) {
        const nextId = await pool.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM canaux");
        canalId = nextId.rows[0].id;
        const { data, error } = await require('../config/supabase')
          .from('canaux')
          .insert({
            id: canalId,
            nom: `Professeurs & Délégués · ${filiere.nom}`,
            description: `Coordination pédagogique de ${filiere.nom}`,
            type,
          })
          .select('id')
          .single();
        if (error) throw error;
        canalId = data.id;
      }
      const membres = await pool.query(
        `SELECT DISTINCT u.id, u.nom, u.prenoms, u.role,
                 CASE WHEN LOWER(u.role) IN ('professeur', 'prof', 'enseignant') THEN 'Professeur'
                   WHEN LOWER(u.etudiant_role) = 'delegue' OR LOWER(u.role) = 'delegue' THEN 'Chef de filière'
                     ELSE 'Sous-chef de filière' END AS fonction
         FROM users u
         LEFT JOIN etudiants e ON e.user_id = u.id
         LEFT JOIN professeurs p ON p.user_id = u.id
         LEFT JOIN module_professeur mp ON mp.professeur_id = p.id
         LEFT JOIN modules m ON m.id = mp.module_id
         WHERE (LOWER(u.role) IN ('professeur', 'prof', 'enseignant')
                AND (m.filiere_id = $1 OR NOT EXISTS (
                  SELECT 1 FROM module_professeur mp2
                  JOIN professeurs p2 ON p2.id = mp2.professeur_id
                  WHERE p2.user_id = u.id
                )))
            OR (e.filiere_id = $1 AND (LOWER(u.etudiant_role) IN ('delegue', 'delegue_adjoint')
              OR LOWER(u.role) IN ('delegue', 'delegue_adjoint')))
         ORDER BY fonction, u.nom`,
        [filiere.id],
      );
      result.push({ ...filiere, id: canalId, filiere_id: filiere.id, type, membres: membres.rows });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[canaux] professeur-filieres', err);
    res.status(500).json({ success: false, message: 'Erreur chargement des canaux par filière.' });
  }
});

// GET /api/canaux - Liste de tous les canaux
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.nom, c.description, c.type, c.created_at,
             (SELECT COUNT(*) FROM canal_membres cm WHERE cm.canal_id = c.id) AS nb_membres
      FROM canaux c
      ORDER BY c.nom
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[canaux] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// POST /api/canaux - Creer un canal (admin)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { nom, description, type } = req.body;
    if (!nom?.trim()) {
      return res.status(400).json({ success: false, message: 'Nom du canal requis.' });
    }
    const result = await pool.query(
      `INSERT INTO canaux (nom, description, type) VALUES ($1, $2, $3) RETURNING *`,
      [nom.trim(), description || null, type || 'general']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[canaux] POST /', err);
    res.status(500).json({ success: false, message: 'Erreur creation canal.' });
  }
});

// POST /api/canaux/:id/membres - Ajouter un membre a un canal
router.post('/:id/membres', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { user_id, role } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'user_id requis.' });
    }
    await pool.query(
      `INSERT INTO canal_membres (canal_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (canal_id, user_id) DO UPDATE SET role = $3`,
      [req.params.id, user_id, role || 'membre']
    );
    res.status(201).json({ success: true, message: 'Membre ajoute au canal.' });
  } catch (err) {
    console.error('[canaux] POST /:id/membres', err);
    res.status(500).json({ success: false, message: 'Erreur ajout membre.' });
  }
});

// GET /api/canaux/:id/membres - Liste des membres d'un canal
router.get('/:id/membres', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nom, u.prenoms, u.matricule, u.role, cm.role AS canal_role
      FROM canal_membres cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.canal_id = $1
      ORDER BY u.nom
    `, [req.params.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[canaux] GET /:id/membres', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// DELETE /api/canaux/:id - Supprimer un canal (admin)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM canaux WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Canal non trouve.' });
    }
    res.json({ success: true, message: 'Canal supprime.' });
  } catch (err) {
    console.error('[canaux] DELETE /:id', err);
    res.status(500).json({ success: false, message: 'Erreur suppression canal.' });
  }
});

module.exports = router;
