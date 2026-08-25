const db = require('../config/db');

exports.getAllFilieres = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM filieres ORDER BY nom ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createFiliere = async (req, res) => {
  const { nom, description } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO filieres (nom, description) VALUES ($1, $2) RETURNING *',
      [nom, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateFiliere = async (req, res) => {
  const { id } = req.params;
  const { nom, description } = req.body;
  try {
    const result = await db.query(
      'UPDATE filieres SET nom = $1, description = $2 WHERE id = $3 RETURNING *',
      [nom, description, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Filière non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteFiliere = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM filieres WHERE id = $1', [id]);
    res.json({ message: 'Filière supprimée avec succès' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getEtudiantsByFiliere = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM etudiants WHERE filiere_id = $1',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
