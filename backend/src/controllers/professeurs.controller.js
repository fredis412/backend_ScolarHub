const db = require('../config/db');
const bcrypt = require('bcryptjs');

// ── Générer un matricule unique PROF-XXXX ─────────────────────────────────────
const genMatricule = async () => {
  const year = new Date().getFullYear().toString().slice(-2);
  let matricule;
  let exists = true;
  while (exists) {
    const num = Math.floor(1000 + Math.random() * 9000);
    matricule = `PROF-${year}${num}`;
    const check = await db.query('SELECT id FROM users WHERE matricule = $1', [matricule]);
    exists = check.rows.length > 0;
  }
  return matricule;
};

// ── GET /api/professeurs ──────────────────────────────────────────────────────
exports.getAllProfesseurs = async (req, res) => {
  try {
    const db = require('../config/db');
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenoms, u.matricule, u.email, u.tel,
              u.statut, u.domaine
       FROM users u
       WHERE u.role = 'professeur'
       ORDER BY u.nom ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getAllProfesseurs:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/professeurs/lookup?nom=X&tel=Y ou ?matricule=X ──────────────────
exports.lookupProfesseur = async (req, res) => {
  try {
    const { nom, tel, matricule } = req.query;
    let user = null;

    if (matricule) {
      const r = await db.query(
        `SELECT id, nom, prenoms, matricule, role, statut, filiere_id, domaine,
                mot_de_passe IS NOT NULL AS a_mot_de_passe
         FROM users WHERE matricule = $1 AND role = 'professeur'`,
        [matricule.trim().toUpperCase()]
      );
      user = r.rows[0];
    } else if (nom && tel) {
      const r = await db.query(
        `SELECT id, nom, prenoms, matricule, role, statut, filiere_id, domaine,
                mot_de_passe IS NOT NULL AS a_mot_de_passe
         FROM users WHERE LOWER(nom) = LOWER($1) AND tel = $2 AND role = 'professeur'`,
        [nom.trim(), tel.trim()]
      );
      user = r.rows[0];
    } else {
      return res.status(400).json({ found: false, message: 'Matricule ou nom+tel requis.' });
    }

    if (!user) return res.status(404).json({ found: false, message: 'Professeur introuvable.' });
    if (user.statut === 'suspendu') return res.status(403).json({ found: false, message: 'Compte suspendu.' });

    return res.status(200).json({
      found: true,
      premierLogin: !user.a_mot_de_passe,
      userId: user.id,
      user: {
        id: user.id, nom: user.nom, prenoms: user.prenoms,
        matricule: user.matricule, role: user.role,
        domaine: user.domaine || '', filiere_id: user.filiere_id,
      },
    });
  } catch (err) {
    console.error('lookupProfesseur:', err.message);
    res.status(500).json({ found: false, message: 'Erreur serveur.' });
  }
};

// ── POST /api/professeurs ─────────────────────────────────────────────────────
exports.createProfesseur = async (req, res) => {
  const { nom, prenoms, tel, email, domaine, filieres_ids } = req.body;
  if (!nom || !prenoms || !tel) {
    return res.status(400).json({ error: 'nom, prenoms et tel sont obligatoires.' });
  }
  const client = await db.connect();
  try {
    // Note: pas de BEGIN/COMMIT - ne fonctionne pas avec Supabase RPC execute_sql
    const matricule = await genMatricule();
    const motDePasse = await bcrypt.hash(tel.trim(), 10);

    // 1. Insérer dans users sans RETURNING
    await client.query(
      `INSERT INTO users (nom, prenoms, matricule, email, tel, role, domaine, statut, mot_de_passe)
       VALUES ($1, $2, $3, $4, $5, 'professeur', $6, 'actif', $7)`,
      [nom.trim().toUpperCase(), prenoms.trim(), matricule,
      email?.trim() || null, tel.trim(), domaine?.trim() || null, motDePasse]
    );

    // Récupérer l'utilisateur inséré
    const userRow = await client.query(
      `SELECT id, nom, prenoms, matricule, email, tel, role, domaine, statut FROM users WHERE matricule = $1`,
      [matricule]
    );
    const user = userRow.rows[0];
    if (!user) throw new Error('Impossible de récupérer le professeur après insertion.');

    // 2. Insérer dans professeurs
    await client.query(
      `INSERT INTO professeurs (user_id, specialite)
       VALUES ($1, $2)`,
      [user.id, domaine?.trim() || null]
    );

    res.status(201).json({
      message: 'Professeur créé avec succès.',
      professeur: user,
      identifiants: {
        matricule,
        motDePasse: tel.trim(),
        info: 'Le mot de passe par défaut est le numéro de téléphone.',
      },
    });
  } catch (err) {
    // Pas de ROLLBACK car pas de BEGIN avec Supabase RPC
    console.error('createProfesseur:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Email ou matricule déjà utilisé.' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ── PUT /api/professeurs/:id ──────────────────────────────────────────────────
exports.updateProfesseur = async (req, res) => {
  const { id } = req.params;
  const { nom, prenoms, email, tel, domaine, statut } = req.body;
  // Note: filieres_ids ignoré car professeur_filieres n'existe pas dans le schéma
  const client = await require('../config/db').connect();
  try {
    // Pas de BEGIN/COMMIT avec Supabase RPC
    await client.query(
      `UPDATE users SET nom=COALESCE($1,nom), prenoms=COALESCE($2,prenoms),
       email=COALESCE($3,email), tel=COALESCE($4,tel),
       domaine=COALESCE($5,domaine), statut=COALESCE($6,statut)
       WHERE id=$7 AND role='professeur'`,
      [nom, prenoms, email, tel, domaine, statut, id]
    );

    // Récupérer l'utilisateur mis à jour
    const result = await client.query(
      `SELECT id, nom, prenoms, matricule, email, tel, role, domaine, statut FROM users WHERE id=$1 AND role='professeur'`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Professeur non trouvé.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateProfesseur:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ── DELETE /api/professeurs/:id ───────────────────────────────────────────────
exports.deleteProfesseur = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`UPDATE users SET statut='renvoye' WHERE id=$1 AND role='professeur'`, [id]);
    res.json({ message: 'Professeur désactivé.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/professeurs/:id ──────────────────────────────────────────────────
exports.getProfesseurById = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nom, prenoms, matricule, email, tel, role, filiere_id, domaine, statut
       FROM users WHERE id=$1 AND role='professeur'`, [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Professeur non trouvé.' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── GET /api/professeurs/profile ──────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nom, prenoms, matricule, email, tel, role, filiere_id, domaine, statut
       FROM users WHERE id=$1`, [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profil introuvable.' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── PUT /api/professeurs/profile ──────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  const { email, tel, domaine } = req.body;
  try {
    await db.query(
      `UPDATE users SET email=COALESCE($1,email), tel=COALESCE($2,tel), domaine=COALESCE($3,domaine)
       WHERE id=$4`,
      [email, tel, domaine, req.user.id]
    );
    const result = await db.query(
      `SELECT id, nom, prenoms, matricule, email, tel, domaine FROM users WHERE id=$1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── GET /api/professeurs/classes ──────────────────────────────────────────────
exports.getClasses = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.id, f.nom, f.niveau, f.domaine, COUNT(e.id)::int AS nb_etudiants
       FROM filieres f LEFT JOIN etudiants e ON e.filiere_id=f.id
       WHERE ($1::uuid IS NULL OR f.id=$1) GROUP BY f.id ORDER BY f.nom`,
      [req.user.filiere_id || null]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── GET /api/professeurs/modules ──────────────────────────────────────────────
exports.getModules = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.* FROM modules m JOIN module_professeur mp ON m.id=mp.module_id WHERE mp.professeur_id=$1`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── GET /api/professeurs/:id/modules ──────────────────────────────────────────
exports.getModulesByProfesseur = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.* FROM modules m JOIN module_professeur mp ON m.id=mp.module_id WHERE mp.professeur_id=$1`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── GET /api/professeurs/classes/:filiere_id/students ─────────────────────────
exports.getStudentsByFiliere = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenoms, u.matricule, u.email, u.tel, u.statut
       FROM users u LEFT JOIN etudiants e ON e.user_id=u.id
       WHERE (e.filiere_id=$1 OR u.filiere_id=$1) AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%') ORDER BY u.nom`,
      [req.params.filiere_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── Disponibilités ────────────────────────────────────────────────────────────
exports.getDisponibilites = async (req, res) => {
  try {
    const r = await db.query('SELECT disponibilites FROM users WHERE id=$1', [req.user.id]);
    res.json(r.rows[0]?.disponibilites || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getAllDisponibilites = async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, nom, prenoms, matricule, disponibilites FROM users WHERE role='professeur' AND disponibilites IS NOT NULL`
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.saveDisponibilites = async (req, res) => {
  try {
    await db.query('UPDATE users SET disponibilites=$1 WHERE id=$2', [JSON.stringify(req.body.disponibilites), req.user.id]);
    res.json({ message: 'Disponibilités enregistrées.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── PATCH /api/professeurs/assign-module ──────────────────────────────────────
exports.patchModuleAssignment = async (req, res) => {
  const { module_id, professeur_id, action } = req.body;
  try {
    if (action === 'assign') {
      await db.query('INSERT INTO module_professeur (module_id, professeur_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [module_id, professeur_id]);
    } else if (action === 'remove') {
      await db.query('DELETE FROM module_professeur WHERE module_id=$1 AND professeur_id=$2', [module_id, professeur_id]);
    } else {
      return res.status(400).json({ error: 'Action invalide.' });
    }
    res.json({ message: `Module ${action === 'assign' ? 'assigné' : 'retiré'} avec succès.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

