const db = require('../config/db');

exports.uploadCours = async (req, res) => {
  try {
    const { titre, description, filiere_id, filiere_nom, niveau, module_id } = req.body;
    const professeur_id = req.user.id;
    const file = req.file;

    if (!titre || !filiere_id || !module_id || !file) {
      return res.status(400).json({ success: false, message: 'Paramètres manquants ou fichier absent' });
    }

    const fichier_nom = file.originalname;
    const fichier_mime = file.mimetype;
    const fichier_data = file.buffer;

    const result = await db.query(`
      INSERT INTO supports_cours 
      (titre, description, filiere_id, filiere_nom, niveau, module_id, professeur_id, fichier_url, fichier_nom, fichier_mime, fichier_data) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
      RETURNING id, titre, description, filiere_id, filiere_nom, niveau, module_id, professeur_id, fichier_url, date_creation
    `, [titre, description, filiere_id, filiere_nom || '', niveau || 'Tous', module_id, professeur_id, '', fichier_nom, fichier_mime, fichier_data]);

    const newCours = result.rows[0];
    const fichier_url = `/api/cours/${newCours.id}/download`;

    await db.query('UPDATE supports_cours SET fichier_url = $1 WHERE id = $2', [fichier_url, newCours.id]);
    newCours.fichier_url = fichier_url;

    res.status(201).json({ success: true, message: 'Cours uploadé avec succès', data: newCours });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.downloadCours = async (req, res) => {
  try {
    const coursId = req.params.id;
    const result = await db.query('SELECT fichier_data, fichier_mime, fichier_nom FROM supports_cours WHERE id = $1', [coursId]);
    
    if (result.rows.length === 0 || !result.rows[0].fichier_data) {
      return res.status(404).json({ success: false, message: 'Fichier introuvable' });
    }

    const file = result.rows[0];
    res.setHeader('Content-Type', file.fichier_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${file.fichier_nom || 'cours.pdf'}"`);
    res.send(file.fichier_data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getCours = async (req, res) => {
  try {
    const professeur_id = req.user.id;
    const result = await db.query(`
      SELECT sc.*, m.nom as module_nom 
      FROM supports_cours sc
      JOIN modules m ON sc.module_id = m.id
      WHERE sc.professeur_id = $1
      ORDER BY sc.date_creation DESC
    `, [professeur_id]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
