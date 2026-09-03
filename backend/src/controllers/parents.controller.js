const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const getParents = async (req, res) => {
  try {
    // On essaie de récupérer depuis la table parents. Si elle est vide, on se rabat sur etudiants.
    let parents = [];
    try {
      const result = await pool.query(`
        SELECT p.*, 
               e.nom AS etudiant_nom, e.prenoms AS etudiant_prenoms, 
               e.matricule, e.filiere_nom, e.niveau
        FROM parents p
        LEFT JOIN etudiants e ON p.matricule_enfant = e.matricule
        ORDER BY p.nom ASC
      `);
      parents = result.rows;
    } catch (err) {
       console.warn("Table parents introuvable ou erreur de jointure:", err.message);
    }
    
    // Fallback : si la table parents est vide, on affiche l'existant via etudiants
    if (parents.length === 0) {
      const fbResult = await pool.query(`
        SELECT DISTINCT
          e.nom_parent AS nom, e.tel_parent AS telephone, e.email_parent AS email,
          'Parent' AS relation, e.matricule AS matricule_enfant,
          e.nom AS etudiant_nom, e.prenoms AS etudiant_prenoms, e.matricule,
          e.filiere_nom, e.niveau, false AS credentialsEnvoyes
        FROM etudiants e
        WHERE e.nom_parent IS NOT NULL AND e.nom_parent != ''
        ORDER BY e.nom_parent
      `);
      parents = fbResult.rows;
    }

    res.json({ success: true, data: parents });
  } catch (err) {
    console.error('[parents.controller] GET /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

const createParent = async (req, res) => {
  let client;
  try {
    const { nom, prenoms, email, telephone, relation, matriculeEnfant } = req.body;

    if (!nom || !prenoms || !matriculeEnfant) {
      return res.status(400).json({ success: false, message: 'Données manquantes.' });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Vérifier si l'étudiant existe
    const etuResult = await client.query('SELECT id, matricule FROM etudiants WHERE matricule = $1', [matriculeEnfant.toUpperCase()]);
    if (etuResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }
    const etudiantId = etuResult.rows[0].id;

    // 2. Créer l'utilisateur Parent dans `users`
    const mdpHashe = await bcrypt.hash('parent123', 10);
    const matriculeParent = `PAR-${Date.now().toString().slice(-6)}`; 

    const userResult = await client.query(`
      INSERT INTO users (matricule, nom, prenoms, email, tel, role, mot_de_passe, statut)
      VALUES ($1, $2, $3, $4, $5, 'parent', $6, 'actif')
      RETURNING id
    `, [matriculeParent, nom.toUpperCase(), prenoms, email, telephone, mdpHashe]);
    
    const userId = userResult.rows[0].id;

    // 3. Insérer dans la table `parents`
    try {
      await client.query(`
        INSERT INTO parents (user_id, nom, prenoms, email, telephone, relation, matricule_enfant, etudiant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [userId, nom.toUpperCase(), prenoms, email, telephone, relation || 'Parent', matriculeEnfant.toUpperCase(), etudiantId]);
    } catch (e) {
      console.warn("Insertion parents a échoué (colonnes potentiellement différentes):", e.message);
      try {
        await client.query(`
          INSERT INTO parents (nom, prenoms, email, telephone, matricule_enfant)
          VALUES ($1, $2, $3, $4, $5)
        `, [nom.toUpperCase(), prenoms, email, telephone, matriculeEnfant.toUpperCase()]);
      } catch (e2) {
         console.error("Échec de secours table parents:", e2.message);
      }
    }

    // 4. Mettre à jour l'étudiant pour référence rapide (nom_parent)
    await client.query(`
      UPDATE etudiants SET nom_parent = $1, tel_parent = $2, email_parent = $3 WHERE matricule = $4
    `, [nom.toUpperCase() + ' ' + prenoms, telephone, email, matriculeEnfant.toUpperCase()]);

    await client.query('COMMIT');
    
    res.json({ success: true, message: 'Parent créé avec succès.' });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('[parents.controller] POST /', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  } finally {
    if (client) client.release();
  }
};

module.exports = {
  getParents,
  createParent,
};
