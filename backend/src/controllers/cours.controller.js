const db = require('../config/db');

const { envoyerNotificationAuto } = require('./notifications.controller');

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

    // Send notifications to students in the class
    try {
      const filtreNiveau = niveau && niveau !== 'Tous' ? ' AND niveau = $2' : '';
      const params = [filiere_id];
      if (niveau && niveau !== 'Tous') params.push(niveau);

      const etudiantsRes = await db.query(`SELECT user_id FROM etudiants WHERE filiere_id = $1${filtreNiveau} AND (statut = 'actif' OR statut IS NULL)`, params);
      const moduleRes = await db.query('SELECT nom FROM modules WHERE id = $1', [module_id]);
      const module_nom = moduleRes.rows.length > 0 ? moduleRes.rows[0].nom : 'Module';

      for (const e of etudiantsRes.rows) {
        if (e.user_id) {
          await envoyerNotificationAuto(
            e.user_id,
            'Nouveau support de cours',
            `Le professeur a publié le support "${titre}" pour le cours de ${module_nom}.`
          );
        }
      }
    } catch (notifErr) {
      console.error('[Notification cours]', notifErr);
    }

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
    const mimeType = file.fichier_mime || 'application/octet-stream';
    const rawName = file.fichier_nom || 'cours.pdf';
    // RFC 5987 : encode le nom pour supporter les accents et caractères spéciaux
    const encodedName = encodeURIComponent(rawName).replace(/'/g, '%27');

    res.setHeader('Content-Type', mimeType);
    // filename= pour les anciens clients, filename*= pour les clients modernes (UTF-8)
    res.setHeader('Content-Disposition', `inline; filename="${rawName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(file.fichier_data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getCours = async (req, res) => {
  try {
    const user = req.user;
    let result;

    if (user.role === 'etudiant') {
      const etuQuery = await db.query('SELECT filiere_id, niveau FROM etudiants WHERE user_id = $1', [user.id]);
      if (etuQuery.rows.length === 0) return res.json({ success: true, data: [] });
      
      const { filiere_id, niveau } = etuQuery.rows[0];
      
      result = await db.query(`
        SELECT sc.id, sc.titre, sc.description, sc.filiere_id, sc.filiere_nom, sc.niveau, sc.module_id, sc.professeur_id, sc.fichier_url, sc.fichier_nom, sc.fichier_mime, sc.date_creation, m.nom as module_nom, u.nom as prof_nom, u.prenoms as prof_prenoms 
        FROM supports_cours sc
        JOIN modules m ON sc.module_id = m.id
        LEFT JOIN users u ON sc.professeur_id = u.id
        WHERE sc.filiere_id = $1 AND sc.niveau = $2
        ORDER BY sc.date_creation DESC
      `, [filiere_id, niveau]);
    } else {
      const professeur_id = user.id;
      result = await db.query(`
        SELECT sc.id, sc.titre, sc.description, sc.filiere_id, sc.filiere_nom, sc.niveau, sc.module_id, sc.professeur_id, sc.fichier_url, sc.fichier_nom, sc.fichier_mime, sc.date_creation, m.nom as module_nom, u.nom as prof_nom, u.prenoms as prof_prenoms 
        FROM supports_cours sc
        JOIN modules m ON sc.module_id = m.id
        LEFT JOIN users u ON sc.professeur_id = u.id
        WHERE sc.professeur_id = $1
        ORDER BY sc.date_creation DESC
      `, [professeur_id]);
    }

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteCours = async (req, res) => {
  try {
    const coursId = req.params.id;
    const professeur_id = req.user.id;
    const result = await db.query(
      'DELETE FROM supports_cours WHERE id = $1 AND professeur_id = $2 RETURNING id',
      [coursId, professeur_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cours introuvable ou non autorisé.' });
    }
    res.json({ success: true, message: 'Cours supprimé.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
