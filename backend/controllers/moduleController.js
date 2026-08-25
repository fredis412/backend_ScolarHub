const db = require('../config/db');
const { getFiliereNomById } = require('../src/utils/filieres');

exports.getAllModules = async (req, res) => {
  const { filiere_id } = req.query;
  try {
    let query = 'SELECT * FROM modules';
    let params = [];
    if (filiere_id) {
      query += ' WHERE filiere_id = $1';
      params.push(filiere_id);
    }
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createModule = async (req, res) => {
  const { nom, coefficient, volume_horaire, filiere_id } = req.body;
  try {
    const filiere_nom = await getFiliereNomById(db, filiere_id);
    const result = await db.query(
      'INSERT INTO modules (nom, coefficient, volume_horaire, filiere_id, filiere_nom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nom, coefficient, volume_horaire, filiere_id, filiere_nom]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateModule = async (req, res) => {
  const { id } = req.params;
  const { nom, coefficient, volume_horaire } = req.body;
  try {
    const result = await db.query(
      'UPDATE modules SET nom = $1, coefficient = $2, volume_horaire = $3 WHERE id = $4 RETURNING *',
      [nom, coefficient, volume_horaire, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Module non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.assignProfessor = async (req, res) => {
  const { module_id, professeur_id } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO module_professeur (module_id, professeur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [module_id, professeur_id]
    );
    res.json({ message: 'Professeur assigné avec succès' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
