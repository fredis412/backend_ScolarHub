const db = require('../config/db');
const { getFiliereNomById } = require('../src/utils/filieres');

// ✅ CORRIGÉ : renvoyait le tableau brut (res.json(result.rows)) alors que
// ApiService.getModules() (Flutter) attend un objet enveloppé
// {success, data: [...]} — comme TOUS les autres endpoints de l'API
// (annonces, evenements, edt, notes, filieres...). Avec l'ancienne forme,
// body['data'] échouait silencieusement côté Flutter et la liste des
// modules restait vide (dropdown "Module" vide dans Saisie directe).
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
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ CORRIGÉ : même problème (res.json(result.rows[0]) au lieu de
// {success, data: {...}}).
exports.createModule = async (req, res) => {
  const { nom, coefficient, volume_horaire, filiere_id } = req.body;
  try {
    const filiere_nom = await getFiliereNomById(db, filiere_id);
    const result = await db.query(
      'INSERT INTO modules (nom, coefficient, volume_horaire, filiere_id, filiere_nom) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nom, coefficient, volume_horaire, filiere_id, filiere_nom]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ CORRIGÉ : même problème.
exports.updateModule = async (req, res) => {
  const { id } = req.params;
  const { nom, coefficient, volume_horaire } = req.body;
  try {
    const result = await db.query(
      'UPDATE modules SET nom = $1, coefficient = $2, volume_horaire = $3 WHERE id = $4 RETURNING *',
      [nom, coefficient, volume_horaire, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Module non trouvé' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.assignProfessor = async (req, res) => {
  const { module_id, professeur_id } = req.body;
  try {
    await db.query(
      'INSERT INTO module_professeur (module_id, professeur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [module_id, professeur_id]
    );
    res.json({ success: true, message: 'Professeur assigné avec succès' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
