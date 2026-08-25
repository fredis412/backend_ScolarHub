const db = require('../config/db');

exports.getFiliereStats = async (req, res) => {
  try {
    const query = `
      SELECT 
        f.nom AS filiere,
        COUNT(e.id) AS nombre_etudiants,
        COALESCE(AVG(CASE WHEN n.valeur >= 10 THEN 100 ELSE 0 END), 0) AS taux_reussite
      FROM filieres f
      LEFT JOIN etudiants e ON f.id = e.filiere_id
      LEFT JOIN notes n ON e.id = n.etudiant_id
      GROUP BY f.id, f.nom
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
