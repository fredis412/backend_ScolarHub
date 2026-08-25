const db = require('../config/db');

// GET /api/professeurs — liste des professeurs (admin, pour attribution de modules)
exports.listProfesseurs = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id AS user_id, u.nom, u.prenoms, u.email, u.tel, p.specialite
      FROM users u
      LEFT JOIN professeurs p ON p.user_id = u.id
      WHERE u.role = 'professeur'
      ORDER BY u.nom, u.prenoms
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ── Disponibilités (heures libres transmises à l'administration) ──────────

// Assure l'existence de la fiche professeurs pour l'utilisateur connecté.
async function ensureProfesseur(userId) {
  let prof = await db.query('SELECT id FROM professeurs WHERE user_id = $1', [userId]);
  if (!prof.rows[0]) {
    prof = await db.query('INSERT INTO professeurs (user_id) VALUES ($1) RETURNING id', [userId]);
  }
  return prof.rows[0].id;
}

// GET /api/professeurs/disponibilites — créneaux libres du prof connecté
exports.getDisponibilites = async (req, res) => {
  try {
    const profId = await ensureProfesseur(req.user.id);
    const result = await db.query(
      `SELECT jour, debut, fin, transmis_le FROM disponibilites_professeur
       WHERE professeur_id = $1 ORDER BY jour, debut`,
      [profId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// PUT /api/professeurs/disponibilites — remplace et transmet les créneaux libres
// Body: { creneaux: [{ jour: 'Lundi', debut: '08:00', fin: '10:00' }, ...] }
exports.saveDisponibilites = async (req, res) => {
  try {
    const { creneaux } = req.body;
    if (!Array.isArray(creneaux)) {
      return res.status(400).json({ success: false, message: 'Liste de créneaux requise.' });
    }
    const profId = await ensureProfesseur(req.user.id);
    await db.query('DELETE FROM disponibilites_professeur WHERE professeur_id = $1', [profId]);
    for (const c of creneaux) {
      if (!c.jour || !c.debut || !c.fin) continue;
      await db.query(
        `INSERT INTO disponibilites_professeur (professeur_id, jour, debut, fin, transmis_le)
         VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING`,
        [profId, c.jour, c.debut, c.fin]
      );
    }
    res.json({ success: true, message: 'Disponibilités transmises à l\'administration.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/professeurs/disponibilites/all — vue admin : heures libres de tous les profs
exports.getAllDisponibilites = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id AS user_id, u.nom, u.prenoms, p.specialite,
             d.jour, d.debut, d.fin, d.transmis_le
      FROM disponibilites_professeur d
      JOIN professeurs p ON p.id = d.professeur_id
      JOIN users u ON u.id = p.user_id
      ORDER BY u.nom, u.prenoms,
               CASE d.jour
                 WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
                 WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6
                 ELSE 7 END,
               d.debut
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(`
      SELECT u.id as user_id, u.nom, u.prenoms, u.email, u.tel, u.matricule, u.role, u.filiere_nom as departement, p.specialite 
      FROM users u 
      LEFT JOIN professeurs p ON u.id = p.user_id 
      WHERE u.id = $1
    `, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Professeur non trouvé' });
    }
    
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { nom, prenoms, tel, email, specialite, departement } = req.body;
    
    await db.query(`
      UPDATE users SET nom = $1, prenoms = $2, tel = $3, email = $4, filiere_nom = $5 
      WHERE id = $6
    `, [nom, prenoms, tel, email, departement, userId]);
    
    // Create or update professeur details
    const pResult = await db.query(`SELECT id FROM professeurs WHERE user_id = $1`, [userId]);
    if (pResult.rows.length > 0) {
      await db.query(`UPDATE professeurs SET specialite = $1 WHERE user_id = $2`, [specialite, userId]);
    } else {
      await db.query(`INSERT INTO professeurs (user_id, specialite) VALUES ($1, $2)`, [userId, specialite]);
    }
    
    res.json({ success: true, message: 'Profil mis à jour avec succès' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getClasses = async (req, res) => {
  try {
    // In our system, "Classes" can be approximated by filieres and niveaux
    // A professor teaches certain modules which belong to certain filieres
    const userId = req.user.id;
    
    const result = await db.query(`
      SELECT DISTINCT f.id, f.nom, f.description, 'Tous' as niveau
      FROM filieres f
      JOIN modules m ON f.id = m.filiere_id
      JOIN module_professeur mp ON m.id = mp.module_id
      JOIN professeurs p ON mp.professeur_id = p.id
      WHERE p.user_id = $1
    `, [userId]);
    
    // If empty (no assigned modules), fetch all filieres to avoid empty state during dev
    if (result.rows.length === 0) {
      const allFilieres = await db.query(`SELECT id, nom, description, 'Tous' as niveau FROM filieres`);
      return res.json({ success: true, data: allFilieres.rows });
    }
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getModules = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(`
      SELECT m.id, m.nom, m.coefficient, m.volume_horaire, m.filiere_id, m.filiere_nom 
      FROM modules m 
      JOIN module_professeur mp ON m.id = mp.module_id 
      JOIN professeurs p ON mp.professeur_id = p.id
      WHERE p.user_id = $1
    `, [userId]);
    
    // If empty, return all modules for now (or empty list if strict)
    if (result.rows.length === 0) {
       const allMods = await db.query(`SELECT m.id, m.nom, m.coefficient, m.volume_horaire, m.filiere_id, m.filiere_nom FROM modules m`);
       return res.json({ success: true, data: allMods.rows });
    }
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getStudentsByFiliere = async (req, res) => {
  try {
    const { filiere_id } = req.params;
    // Certains anciens comptes n'ont que le nom de la filière (filiere_id NULL) :
    // on matche par id OU par nom, et on complète les champs manquants via users.
    const result = await db.query(`
      SELECT e.id,
             COALESCE(e.nom, u.nom) AS nom,
             COALESCE(e.prenoms, u.prenoms) AS prenoms,
             COALESCE(e.matricule, u.matricule) AS matricule,
             COALESCE(e.email, u.email) AS email,
             COALESCE(e.tel, u.tel) AS tel,
             COALESCE(e.niveau, u.niveau) AS niveau
      FROM etudiants e
      JOIN users u ON u.id = e.user_id
      CROSS JOIN (SELECT nom FROM filieres WHERE id = $1) f
      WHERE u.role = 'etudiant'
        AND (e.filiere_id = $1
             OR LOWER(regexp_replace(COALESCE(e.filiere_nom, u.filiere_nom, ''), '[^a-zA-Z0-9 ]', '', 'g')) =
                LOWER(regexp_replace(f.nom, '[^a-zA-Z0-9 ]', '', 'g')))
      ORDER BY nom ASC
    `, [filiere_id]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
