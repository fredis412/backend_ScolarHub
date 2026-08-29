const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const supabase = require('../config/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

router.get('/', authMiddleware, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT id, nom, description FROM filieres ORDER BY nom');
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('[filieres]', err.message);
    return res.status(500).json({ message: 'Erreur chargement filieres.' });
  } finally {
    if (client) client.release();
  }
});

router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nom, description } = req.body;
  if (!nom?.trim()) return res.status(400).json({ message: 'Nom de filière requis.' });
  try {
    const { data, error } = await supabase
      .from('filieres')
      .insert({ nom: nom.trim(), description: description || null })
      .select('id, nom, description')
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err) {
    console.error('[filieres] POST /', err.message);
    return res.status(500).json({ message: 'Erreur création filière.' });
  }
});

module.exports = router;
