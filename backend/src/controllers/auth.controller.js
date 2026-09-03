const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const supabase = require('../config/supabase');
const emailService = require('../services/email.service');

const genToken = (user) => jwt.sign(
  { id: user.id, matricule: user.matricule, role: user.role, filiere_id: user.filiere_id },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const login = async (req, res) => {
  try {
    const { matricule, nom, tel, motDePasse, password, userId, prenom, prenoms } = req.body;
    const mdp = password || motDePasse; // Accepter les deux formats
    let user = null;

    try {
      if (userId) {
        const r = await pool.query(
          `SELECT u.*, e.filiere_id,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau) AS niveau_etudiant,
                  COALESCE(e.email, u.email) AS email_etudiant,
                  COALESCE(e.tel, u.tel) AS tel_etudiant,
                  COALESCE(m.permissions->>'domaine', u.admin_domaine, 'Tous') AS admin_domaine,
                  COALESCE(p.matricule_enfant, p_etu.matricule) AS matricule_enfant,
                  CASE 
                    WHEN p_etu.nom IS NOT NULL THEN TRIM(COALESCE(p_etu.prenoms, '') || ' ' || p_etu.nom)
                    ELSE NULL 
                  END AS enfant_nom
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.telephone, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           LEFT JOIN etudiants p_etu ON (p.matricule_enfant = p_etu.matricule OR p.etudiant_id = p_etu.id OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           LEFT JOIN membres m ON u.id = m.user_id
           WHERE u.id::text = $1`,
          [userId.toString()]
        );
        user = r.rows[0];
      } else if (matricule) {
        const matClean = matricule.trim().toLowerCase();
        const r = await pool.query(
          `SELECT u.*, e.filiere_id,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau) AS niveau_etudiant,
                  COALESCE(e.email, u.email) AS email_etudiant,
                  COALESCE(e.tel, u.tel) AS tel_etudiant,
                  COALESCE(m.permissions->>'domaine', u.admin_domaine, 'Tous') AS admin_domaine,
                  COALESCE(p.matricule_enfant, p_etu.matricule) AS matricule_enfant,
                  CASE 
                    WHEN p_etu.nom IS NOT NULL THEN TRIM(COALESCE(p_etu.prenoms, '') || ' ' || p_etu.nom)
                    ELSE NULL 
                  END AS enfant_nom
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.telephone, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           LEFT JOIN etudiants p_etu ON (p.matricule_enfant = p_etu.matricule OR p.etudiant_id = p_etu.id OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           LEFT JOIN membres m ON u.id = m.user_id
           WHERE LOWER(u.matricule) = $1 OR LOWER(u.email) = $1`,
          [matClean]
        );
        user = r.rows[0];
      } else if (nom && (tel || req.body.telephone)) {
        const telVal = (tel || req.body.telephone).trim().replace(/\s+/g, '');
        const prenomVal = (prenom || prenoms || req.body.prenom || req.body.prenoms || '').trim();
        const r = await pool.query(
          `SELECT u.*, e.filiere_id,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau) AS niveau_etudiant,
                  COALESCE(e.email, u.email) AS email_etudiant,
                  COALESCE(e.tel, u.tel) AS tel_etudiant,
                  COALESCE(p.matricule_enfant, p_etu.matricule) AS matricule_enfant,
                  CASE 
                    WHEN p_etu.nom IS NOT NULL THEN TRIM(COALESCE(p_etu.prenoms, '') || ' ' || p_etu.nom)
                    ELSE NULL 
                  END AS enfant_nom
           FROM users u 
           LEFT JOIN etudiants e ON u.id = e.user_id 
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.telephone, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           LEFT JOIN etudiants p_etu ON (p.matricule_enfant = p_etu.matricule OR p.etudiant_id = p_etu.id OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           WHERE LOWER(TRIM(u.nom)) = LOWER(TRIM($1)) 
             AND (REPLACE(COALESCE(u.tel, ''), ' ', '') = $2 OR REPLACE(COALESCE(u.tel, ''), ' ', '') LIKE $3)
             ${prenomVal ? "AND (LOWER(TRIM(u.prenoms)) = LOWER(TRIM($4)) OR LOWER(u.prenoms) LIKE $5)" : ""}`,
          prenomVal 
            ? [nom.trim(), telVal, `%${telVal}%`, prenomVal, `%${prenomVal}%`] 
            : [nom.trim(), telVal, `%${telVal}%`]
        );
        user = r.rows[0];
      } else {
        return res.status(400).json({ message: 'Identifiants manquants.' });
      }
    } catch (dbErr) {
      console.warn('Direct PG failed in login, fallback to Supabase SDK:', dbErr.message);
      if (supabase && typeof supabase.from === 'function') {
        let query = supabase.from('users').select('*');
        if (userId) {
          query = query.eq('id', userId);
        } else if (matricule) {
          const matClean = matricule.trim().toLowerCase();
          query = query.or(`matricule.ilike.${matClean},email.ilike.${matClean}`);
        } else if (nom && tel) {
          query = query.ilike('nom', `%${nom.trim()}%`);
        }
        const { data, error } = await query.maybeSingle();
        if (!error && data) {
          user = data;
        }
      }
    }

    if (!user) return res.status(404).json({ message: 'Matricule non reconnu.' });
    if (user.statut === 'suspendu') return res.status(403).json({ message: 'Compte suspendu.' });
    if (user.statut === 'renvoye') return res.status(403).json({ message: 'Compte desactive.' });

    const motDePasseExiste = user.mot_de_passe && user.mot_de_passe.trim() !== '' && user.mot_de_passe !== 'null';
    const isFirstTimeRole = !user.role || user.role === 'etudiant' || user.role === 'bde' || user.role === 'parent';
    const estPremiereFois = isFirstTimeRole && (user.premierefois === true || user.premiere_fois === true || !motDePasseExiste);

    // Première connexion : pas encore de mot de passe défini en base (étudiants et parents)
    if (estPremiereFois || (isFirstTimeRole && !motDePasseExiste)) {
      // Si l'utilisateur n'a pas soumis de mot de passe, on renvoie le signal de première connexion
      if (!mdp || mdp.trim() === '') {
        return res.status(200).json({
          premiereFois: true,
          student: {
            id: user.id,
            matricule: user.matricule,
            nom: user.nom,
            prenoms: user.prenoms,
            email: user.email_etudiant || user.email || '',
            telephone: user.tel_etudiant || user.tel || '',
            filiere: user.filiere || user.filiere_nom || '',
            filiere_id: user.filiere_id,
            niveau: user.niveau_etudiant || user.niveau || '',
            role: user.role || 'etudiant',
          }
        });
      }
    }

    // Si mot de passe requis mais absent
    if (!mdp || mdp.trim() === '') {
      return res.status(400).json({ message: 'Veuillez saisir votre mot de passe.' });
    }

    let match = false;
    if (user.mot_de_passe && (user.mot_de_passe.startsWith('$2a$') || user.mot_de_passe.startsWith('$2b$'))) {
      try {
        match = await bcrypt.compare(mdp, user.mot_de_passe); 
      } catch (_) {
        match = false;
      }
    } else {
      // Cas des mots de passe initialisés en clair
      match = (mdp === user.mot_de_passe);
      // Mise à jour automatique en hash bcrypt si succès
      if (match) {
        bcrypt.hash(mdp, 10).then(h => {
          pool.query('UPDATE users SET mot_de_passe = $1 WHERE id = $2', [h, user.id]).catch(() => { });
        });
      }
    }

    if (!match) return res.status(401).json({ message: 'Mot de passe incorrect.' });

    const token = genToken(user);
    const { mot_de_passe, ...safeUser } = user;

    // S'assurer que le role est bien transmis même si la colonne est aliasée différemment
    console.log(`[LOGIN] user ${safeUser.nom} - role="${safeUser.role}" admin_sub_role="${safeUser.admin_sub_role}"`);

    // Si c'est un parent : synchroniser automatiquement le user_id dans la table parents
    // pour que /parents/mon-enfant puisse toujours retrouver l'enfant lié
    if (safeUser.role === 'parent' || safeUser.role === 'tuteur') {
      const telClean = (safeUser.tel || '').trim().replace(/\s+/g, '');
      pool.query(
        `UPDATE parents SET user_id = $1
         WHERE user_id IS NULL
           AND (REPLACE(COALESCE(telephone,''),' ','') = $2
            OR LOWER(nom) = LOWER($3))`,
        [safeUser.id, telClean, safeUser.nom || '']
      ).catch(e => console.warn('[LOGIN] Sync parents.user_id:', e.message));
    }

    const responseUser = {
      ...safeUser,
      role: safeUser.role || 'etudiant',
      admin_sub_role: safeUser.admin_sub_role || null,
      admin_domaine: safeUser.admin_domaine || 'Tous',
    };

    return res.status(200).json({ token, user: responseUser });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const setupPassword = async (req, res) => {
  try {
    const { userId, email, motDePasse } = req.body;
    if (!userId || !motDePasse) return res.status(400).json({ message: 'Donnees manquantes.' });

    let checkUser = null;
    try {
      const check = await pool.query('SELECT id, mot_de_passe FROM users WHERE id = $1', [userId]);
      checkUser = check.rows[0];
    } catch (dbErr) {
      console.warn('Direct PG failed in setupPassword, fallback to Supabase SDK:', dbErr.message);
      if (supabase && typeof supabase.from === 'function') {
        const { data } = await supabase.from('users').select('id, mot_de_passe').eq('id', userId).maybeSingle();
        checkUser = data;
      }
    }

    if (!checkUser) return res.status(404).json({ message: 'Utilisateur introuvable.' });
    if (checkUser.mot_de_passe) {
      return res.status(403).json({ message: 'Mot de passe deja defini. Utilisez /change-password.' });
    }

    const hashed = await bcrypt.hash(motDePasse, 10);

    try {
      await pool.query('UPDATE users SET mot_de_passe = $1, email = $2 WHERE id = $3', [hashed, email || null, userId]);
    } catch (dbErr) {
      if (supabase && typeof supabase.from === 'function') {
        await supabase.from('users').update({ mot_de_passe: hashed, email: email || null }).eq('id', userId);
      }
    }

    return res.status(200).json({ message: 'Mot de passe defini avec succes.' });
  } catch (err) {
    console.error('SetupPassword error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Recherche publique par matricule : renvoie les infos d'affichage (sans mot de
// passe) + le drapeau premierLogin. Sert à l'écran de connexion pour afficher la
// carte de l'étudiant AVANT la saisie / définition du mot de passe.
const lookup = async (req, res) => {
  try {
    const matricule = (req.query.matricule || '').trim().toUpperCase();
    const nom = (req.query.nom || '').trim();
    const prenom = (req.query.prenom || req.query.prenoms || '').trim();
    const tel = (req.query.tel || req.query.telephone || req.query.numero || '').trim().replaceAll(' ', '');

    let row = null;

    if (matricule) {
      try {
        const r = await pool.query(
          `SELECT u.id, u.nom, u.prenoms, u.matricule, u.role, u.admin_sub_role, u.statut,
                  u.mot_de_passe IS NOT NULL AND u.mot_de_passe != '' AND u.mot_de_passe != 'null' AS a_mot_de_passe,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere_nom,
                  COALESCE(e.domaine, p_etu.domaine, u.domaine)        AS domaine,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau)          AS niveau,
                  COALESCE(p.matricule_enfant, p_etu.matricule) AS matricule_enfant,
                  p_etu.nom AS enfant_nom,
                  p_etu.prenoms AS enfant_prenoms
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.telephone, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           LEFT JOIN etudiants p_etu ON (p.matricule_enfant = p_etu.matricule OR p.etudiant_id = p_etu.id OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           WHERE UPPER(TRIM(u.matricule)) = $1 OR LOWER(TRIM(u.email)) = LOWER(TRIM($1))`,
          [matricule]
        );
        row = r.rows[0];
      } catch (dbErr) {
        console.warn('Direct PG failed in lookup by matricule, fallback to Supabase SDK:', dbErr.message);
        if (supabase && typeof supabase.from === 'function') {
          const { data, error } = await supabase
            .from('users')
            .select('id, nom, prenoms, matricule, role, admin_sub_role, statut, mot_de_passe, filiere_nom, domaine, niveau')
            .eq('matricule', matricule)
            .maybeSingle();
          if (!error && data) {
            row = {
              id: data.id,
              nom: data.nom,
              prenoms: data.prenoms,
              matricule: data.matricule,
              role: data.role,
              admin_sub_role: data.admin_sub_role,
              statut: data.statut,
              a_mot_de_passe: !!data.mot_de_passe,
              filiere_nom: data.filiere_nom,
              domaine: data.domaine,
              niveau: data.niveau,
            };
          }
        }
      }
    } else if (nom && prenom && tel) {
      try {
        const r = await pool.query(
          `SELECT u.id, u.nom, u.prenoms, u.matricule, u.role, u.admin_sub_role, u.statut,
                  u.mot_de_passe IS NOT NULL AND u.mot_de_passe != '' AND u.mot_de_passe != 'null' AS a_mot_de_passe,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere_nom,
                  COALESCE(e.domaine, p_etu.domaine, u.domaine)        AS domaine,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau)          AS niveau,
                  COALESCE(p.matricule_enfant, p_etu.matricule) AS matricule_enfant,
                  p_etu.nom AS enfant_nom,
                  p_etu.prenoms AS enfant_prenoms
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.telephone, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           LEFT JOIN etudiants p_etu ON (p.matricule_enfant = p_etu.matricule OR p.etudiant_id = p_etu.id OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', ''))
           WHERE LOWER(TRIM(u.nom)) = LOWER(TRIM($1))
             AND (LOWER(TRIM(u.prenoms)) = LOWER(TRIM($2)) OR LOWER(u.prenoms) LIKE LOWER($3) OR LOWER(u.nom) LIKE LOWER($3))
             AND (REPLACE(COALESCE(u.tel, ''), ' ', '') = $4 OR REPLACE(COALESCE(u.tel, ''), ' ', '') LIKE $5 OR $4 LIKE ('%' || REPLACE(COALESCE(u.tel, ''), ' ', '') || '%'))`,
          [nom.trim(), prenom.trim(), `%${prenom.trim()}%`, tel.trim().replace(/\s+/g, ''), `%${tel.trim().replace(/\s+/g, '')}%`]
        );
        row = r.rows[0];
      } catch (dbErr) {
        console.warn('Direct PG failed in lookup by details, fallback to Supabase SDK:', dbErr.message);
        if (supabase && typeof supabase.from === 'function') {
          const { data, error } = await supabase
            .from('users')
            .select('id, nom, prenoms, matricule, role, admin_sub_role, statut, mot_de_passe, filiere_nom, domaine, niveau')
            .ilike('nom', nom)
            .ilike('prenoms', `%${prenom}%`)
            .maybeSingle();
          if (!error && data) {
            row = {
              id: data.id,
              nom: data.nom,
              prenoms: data.prenoms,
              matricule: data.matricule,
              role: data.role,
              admin_sub_role: data.admin_sub_role,
              statut: data.statut,
              a_mot_de_passe: !!data.mot_de_passe,
              filiere_nom: data.filiere_nom,
              domaine: data.domaine,
              niveau: data.niveau,
            };
          }
        }
      }
    } else {
      return res.status(400).json({ found: false, message: 'Matricule ou détails (nom, prenom, tel) requis.' });
    }

    if (!row) return res.status(404).json({ found: false, message: 'Utilisateur non reconnu.' });
    if (row.statut === 'suspendu' || row.statut === 'renvoye') {
      return res.status(403).json({ found: false, message: 'Compte désactivé. Contactez l\'administration.' });
    }

    const enfantNomComplet = (row.enfant_prenoms || row.enfant_nom) 
      ? `${row.enfant_prenoms || ''} ${row.enfant_nom || ''}`.trim() 
      : (row.enfant_nom || '');

    return res.status(200).json({
      found: true,
      premierLogin: !row.a_mot_de_passe,
      userId: row.id,
      user: {
        id: row.id,
        nom: row.nom,
        prenoms: row.prenoms,
        matricule: row.matricule,
        role: row.role,
        admin_sub_role: row.admin_sub_role,
        filiere: row.filiere_nom || '',
        domaine: row.domaine || '',
        niveau: row.niveau || '',
        enfant_nom: enfantNomComplet,
        matricule_enfant: row.matricule_enfant || '',
      },
    });
  } catch (err) {
    console.error('Lookup error:', err);
    return res.status(500).json({ found: false, message: 'Erreur serveur.' });
  }
};

const me = async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT u.id, u.nom, u.prenoms, u.matricule, u.email, u.tel, u.role, u.statut, e.filiere_id FROM users u LEFT JOIN etudiants e ON u.id = e.user_id WHERE u.id = $1',
      [req.user.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Introuvable.' });
    return res.status(200).json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { ancienMotDePasse, nouveauMotDePasse } = req.body;
    if (!ancienMotDePasse || !nouveauMotDePasse) {
      return res.status(400).json({ message: 'Ancien et nouveau mot de passe requis.' });
    }
    const r = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!r.rows[0]) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }
    if (!r.rows[0].mot_de_passe) {
      return res.status(400).json({ message: 'Aucun mot de passe configuré. Utilisez la configuration initiale.' });
    }
    const isValid = await bcrypt.compare(ancienMotDePasse, r.rows[0].mot_de_passe);
    if (!isValid) return res.status(401).json({ message: 'Ancien mot de passe incorrect.' });
    const hashed = await bcrypt.hash(nouveauMotDePasse, 10);
    await pool.query('UPDATE users SET mot_de_passe = $1 WHERE id = $2', [hashed, req.user.id]);
    return res.status(200).json({ message: 'Mot de passe mis a jour.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const register = async (req, res) => {
  let client;
  try {
    const { nom, prenoms, email, telephone, motDePasse, matricule: matriculeBody, filiere, niveau } = req.body;

    if (!nom?.trim() || !prenoms?.trim()) {
      return res.status(400).json({ message: 'Nom et prenom requis.' });
    }
    if (!motDePasse || motDePasse.length < 4) {
      return res.status(400).json({ message: 'Mot de passe requis (4 caracteres minimum).' });
    }
    if (!filiere?.trim()) {
      return res.status(400).json({ message: 'Filiere requise.' });
    }
    if (!niveau?.trim()) {
      return res.status(400).json({ message: 'Niveau requis.' });
    }

    client = await pool.connect();

    await client.query('BEGIN');

    // Generate matricule if not provided
    let matricule = matriculeBody?.trim().toUpperCase();
    if (!matricule) {
      const annee = new Date().getFullYear().toString().slice(2);
      const countRes = await client.query("SELECT COUNT(*)::int AS c FROM users WHERE role = 'etudiant'");
      let num = 1900 + countRes.rows[0].c + 1;
      matricule = `${annee}IST-O2/${num}`;
      let exists = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
      while (exists.rows.length > 0) {
        num += 1;
        matricule = `${annee}IST-O2/${num}`;
        exists = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
      }
    }

    // Check uniqueness
    const existingUser = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Ce matricule est deja utilise.' });
    }

    if (email?.trim()) {
      const existingEmail = await client.query('SELECT 1 FROM users WHERE email = $1', [email.trim()]);
      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Cet email est deja utilise.' });
      }
    }

    const hashed = await bcrypt.hash(motDePasse, 10);

    const filiereRes = await client.query('SELECT id FROM filieres WHERE nom = $1', [filiere.trim()]);
    const filiereId = filiereRes.rows[0]?.id || null;

    const userRes = await client.query(
      `INSERT INTO users (matricule, nom, prenoms, email, tel, role, statut, mot_de_passe)
       VALUES ($1, $2, $3, $4, $5, 'etudiant', 'actif', $6) RETURNING *`,
      [matricule, nom.trim().toUpperCase(), prenoms.trim(), email?.trim() || null, telephone?.trim() || null, hashed]
    );
    const user = userRes.rows[0];

    // Create etudiants record
    await client.query(
      `INSERT INTO etudiants (user_id, filiere_id, premierefois, matricule, nom, prenoms, email, tel, filiere_nom, niveau, statut)
       VALUES ($1, $2, false, $3, $4, $5, $6, $7, $8, $9, 'actif')`,
      [user.id, filiereId, matricule, nom.trim().toUpperCase(), prenoms.trim(), email?.trim() || null, telephone?.trim() || null, filiere.trim(), niveau.trim()]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      token: genToken(user),
      user: {
        id: user.id,
        nom: user.nom,
        prenoms: user.prenoms,
        matricule: user.matricule,
        role: user.role,
        statut: user.statut,
        filiere: filiere.trim(),
        niveau: niveau.trim(),
      },
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { }
    }
    console.error('Register error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Matricule ou email deja utilise.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    if (client) client.release();
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { identifiant } = req.body;
    if (!identifiant) return res.status(400).json({ message: 'Matricule ou email requis.' });

    // Chercher l'utilisateur par matricule ou email
    const r = await pool.query(
      'SELECT id, email, nom FROM users WHERE matricule = $1 OR email = $1',
      [identifiant.trim().toUpperCase()]
    );
    const user = r.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    if (!user.email) {
      return res.status(400).json({ message: 'Aucune adresse email associée à ce compte.' });
    }

    // Générer un code à 6 chiffres
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60000); // 15 minutes

    // Sauvegarder dans la DB
    await pool.query(
      'UPDATE users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
      [resetCode, expiresAt, user.id]
    );

    // Envoyer l'email
    const emailResult = await emailService.envoyer(
      user.email,
      'ScolarHub - Réinitialisation de mot de passe',
      {
        text: `Bonjour ${user.nom},\n\nVotre code de réinitialisation est : ${resetCode}\n\nCe code expirera dans 15 minutes.\n\nL'équipe ScolarHub`,
      }
    );

    if (!emailResult.success) {
      console.error('Failed to send email:', emailResult.error);
      // We still return success so we don't block testing in dev, but ideally handle it better
    }

    return res.status(200).json({
      message: 'Un code de réinitialisation a été envoyé à votre adresse email.',
      email: user.email,
      code: (process.env.EMAIL_PROVIDER === 'console' || process.env.NODE_ENV !== 'production') ? resetCode : undefined,
    });
  } catch (err) {
    console.error('ForgotPassword error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { identifiant, code, newPassword } = req.body;
    if (!identifiant || !code || !newPassword) {
      return res.status(400).json({ message: 'Données manquantes.' });
    }

    // Chercher l'utilisateur
    const r = await pool.query(
      'SELECT id, reset_code, reset_expires FROM users WHERE matricule = $1 OR email = $1',
      [identifiant.trim().toUpperCase()]
    );
    const user = r.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    if (user.reset_code !== code) {
      return res.status(400).json({ message: 'Code de réinitialisation incorrect.' });
    }

    if (new Date() > new Date(user.reset_expires)) {
      return res.status(400).json({ message: 'Le code de réinitialisation a expiré.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET mot_de_passe = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [hashed, user.id]
    );

    return res.status(200).json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('ResetPassword error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  login,
  setupPassword,
  me,
  changePassword,
  register,
  lookup,
  forgotPassword,
  resetPassword,
};
