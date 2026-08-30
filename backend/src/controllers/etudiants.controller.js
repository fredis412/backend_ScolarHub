const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { ensureFilieres } = require('../utils/filieres');
const { notifierInscription } = require('../services/inscription.notify');

const domaineFromFiliere = (filiere) => {
  const f = (filiere || '').toLowerCase();
  if (f.includes('marketing') || f.includes('gestion') || f.includes('finance') || f.includes('comptab')) {
    return 'Sciences de Gestion';
  }
  return 'Sciences & Technologies';
};

const generateMatricule = async (client) => {
  const annee = new Date().getFullYear().toString().slice(2);
  const countRes = await client.query(
    "SELECT COUNT(*)::int AS c FROM users WHERE role = 'etudiant'"
  );
  let num = 1900 + countRes.rows[0].c + 1;
  let matricule = `${annee}IST-O2/${num}`;
  let exists = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
  while (exists.rows.length > 0) {
    num += 1;
    matricule = `${annee}IST-O2/${num}`;
    exists = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
  }
  return matricule;
};

const mapRowToEtudiant = (row) => ({
  id: row.etudiant_id,
  userId: row.user_id,
  matricule: row.matricule,
  nom: row.nom,
  prenoms: row.prenoms,
  email: row.email || '',
  telephone: row.tel || '',
  filiere: row.filiere_nom || '',
  filiereId: row.filiere_id,
  domaine: row.domaine || domaineFromFiliere(row.filiere_nom),
  niveau: row.niveau || '',
  dateNaissance: row.date_naissance || '',
  nationalite: row.nationalite || 'Burkinabè',
  adresse: row.adresse || '',
  nomParent: row.nom_parent || '',
  telParent: row.tel_parent || '',
  emailParent: row.email_parent || '',
  statut: row.statut || 'actif',
  role: row.etudiant_role || 'etudiant',
  filiereRole: row.filiere_role || null,
  premiereFois: row.premierefois ?? true,
});

// ── Intégrer automatiquement un étudiant dans le groupe filière ───────────────
const integrerDansGroupeFiliere = async (client, userId, filiereId, filiere, matricule) => {
  try {
    // 1. Vérifier si le groupe filière existe, sinon le créer
    let groupeRes = await client.query(
      `SELECT id FROM groupes WHERE filiere_id = $1 AND type = 'filiere' LIMIT 1`,
      [filiereId]
    );

    let groupeId;
    if (groupeRes.rows.length === 0) {
      // Créer le groupe filière
      const newGroupe = await client.query(
        `INSERT INTO groupes (nom, type, filiere_id, description, created_at)
         VALUES ($1, 'filiere', $2, $3, NOW())
         RETURNING id`,
        [
          `Groupe ${filiere}`,
          filiereId,
          `Groupe officiel de la filière ${filiere}`
        ]
      );
      groupeId = newGroupe.rows[0].id;
      console.log(`[integrerDansGroupeFiliere] Groupe filière créé: ${groupeId}`);
    } else {
      groupeId = groupeRes.rows[0].id;
    }

    // 2. Vérifier si le groupe admin-filière existe, sinon le créer
    let groupeAdminRes = await client.query(
      `SELECT id FROM groupes WHERE filiere_id = $1 AND type = 'admin_filiere' LIMIT 1`,
      [filiereId]
    );

    let groupeAdminId;
    if (groupeAdminRes.rows.length === 0) {
      const newGroupeAdmin = await client.query(
        `INSERT INTO groupes (nom, type, filiere_id, description, created_at)
         VALUES ($1, 'admin_filiere', $2, $3, NOW())
         RETURNING id`,
        [
          `Admin - ${filiere}`,
          filiereId,
          `Canal Administration pour la filière ${filiere}`
        ]
      );
      groupeAdminId = newGroupeAdmin.rows[0].id;
      console.log(`[integrerDansGroupeFiliere] Groupe admin-filière créé: ${groupeAdminId}`);
    } else {
      groupeAdminId = groupeAdminRes.rows[0].id;
    }

    // 3. Ajouter l'étudiant dans le groupe filière
    await client.query(
      `INSERT INTO groupe_membres (groupe_id, user_id, role, joined_at)
       VALUES ($1, $2, 'membre', NOW())
       ON CONFLICT (groupe_id, user_id) DO NOTHING`,
      [groupeId, userId]
    );

    // 4. Ajouter l'étudiant dans le groupe admin-filière
    await client.query(
      `INSERT INTO groupe_membres (groupe_id, user_id, role, joined_at)
       VALUES ($1, $2, 'membre', NOW())
       ON CONFLICT (groupe_id, user_id) DO NOTHING`,
      [groupeAdminId, userId]
    );

    console.log(`[integrerDansGroupeFiliere] Étudiant ${matricule} intégré dans groupes ${groupeId} et ${groupeAdminId}`);
    return { groupeId, groupeAdminId };
  } catch (err) {
    // Ne pas bloquer l'inscription si l'intégration échoue
    console.error('[integrerDansGroupeFiliere] Erreur (non bloquante):', err.message);
    return null;
  }
};

// ── GET /api/etudiants ────────────────────────────────────────────────────────
const listEtudiants = async (req, res) => {
  try {
    // Filtre domaine : si l'admin est restreint à un domaine, on ne retourne que ses étudiants
    const domaineFiltreRaw = (req.query.domaine || '').trim();
    const domaineFiltre = (domaineFiltreRaw === 'Tous' || domaineFiltreRaw === '') ? null : domaineFiltreRaw;

    console.log('[listEtudiants] domaineFiltre:', domaineFiltre || 'aucun');

    // Requête robuste : on utilise uniquement des colonnes garanties dans le schéma de base
    // etudiant_role et filiere_role sont sécurisées via COALESCE avec NULL
    let queryText = `
      SELECT
        e.id AS etudiant_id,
        e.user_id,
        COALESCE(e.matricule, u.matricule) AS matricule,
        COALESCE(e.nom, u.nom) AS nom,
        COALESCE(e.prenoms, u.prenoms) AS prenoms,
        COALESCE(e.email, u.email) AS email,
        COALESCE(e.tel, u.tel) AS tel,
        COALESCE(e.statut, u.statut, 'actif') AS statut,
        COALESCE(e.domaine, u.domaine) AS domaine,
        COALESCE(e.niveau, u.niveau) AS niveau,
        COALESCE(e.date_naissance, u.date_naissance) AS date_naissance,
        COALESCE(e.nationalite, u.nationalite, 'Burkinabè') AS nationalite,
        COALESCE(e.adresse, u.adresse) AS adresse,
        COALESCE(e.nom_parent, u.nom_parent) AS nom_parent,
        COALESCE(e.tel_parent, u.tel_parent) AS tel_parent,
        COALESCE(e.email_parent, u.email_parent) AS email_parent,
        u.etudiant_role,
        u.filiere_role,
        e.filiere_id,
        e.premierefois,
        COALESCE(e.filiere_nom, f.nom) AS filiere_nom
      FROM etudiants e
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN filieres f ON f.id = e.filiere_id
      WHERE u.role = 'etudiant'
    `;

    const params = [];
    if (domaineFiltre) {
      params.push(domaineFiltre);
      queryText += `
        AND (
          COALESCE(e.domaine, u.domaine) = $${params.length}
          OR COALESCE(e.filiere_nom, f.nom) ILIKE '%' || $${params.length} || '%'
        )
      `;
    }

    queryText += ' ORDER BY COALESCE(e.nom, u.nom), COALESCE(e.prenoms, u.prenoms)';

    const result = await pool.query(queryText, params);
    console.log('[listEtudiants] retour:', result.rows.length, 'étudiant(s)');
    
    if (result.rows.length === 0) {
      try {
        // 1. Nombre de comptes étudiants dans users
        const countUsers = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'etudiant'");
        // 2. Nombre de lignes dans etudiants
        const countEtu = await pool.query("SELECT COUNT(*)::int AS count FROM etudiants");
        // 3. Nombre d'orphelins (etudiants pointant vers aucun user)
        const countOrphans = await pool.query("SELECT COUNT(*)::int AS count FROM etudiants e LEFT JOIN users u ON u.id = e.user_id WHERE u.id IS NULL");
        // 4. Rôles des users liés dans la table etudiants
        const rolesLinked = await pool.query("SELECT u.role, COUNT(*)::int AS count FROM etudiants e INNER JOIN users u ON u.id = e.user_id GROUP BY u.role");
        
        const rolesStr = rolesLinked.rows.map(r => `${r.role}:${r.count}`).join(', ') || 'aucun';
        
        return res.status(200).json([{
          etudiant_id: 9999,
          user_id: '00000000-0000-0000-0000-000000000000',
          matricule: 'DIAGNOSTIC',
          nom: `ORPHANS_${countOrphans.rows[0].count} ROLES_[${rolesStr}]`,
          prenoms: `USERS_ETU_${countUsers.rows[0].count} TAB_ETU_${countEtu.rows[0].count}`,
          email: 'debug@ist.bf',
          tel: '00000000',
          statut: 'actif',
          domaine: 'Tous',
          niveau: 'Licence 1',
          date_naissance: '',
          nationalite: 'Burkinabè',
          adresse: '',
          nom_parent: '',
          tel_parent: '',
          email_parent: '',
          etudiant_role: 'etudiant',
          filiere_role: null,
          filiere_id: 1,
          premierefois: false,
          filiere_nom: 'Diagnostic'
        }]);
      } catch (diagErr) {
        console.error('[Diagnostic listEtudiants] Erreur lors du comptage:', diagErr.message);
      }
    }

    return res.status(200).json(result.rows.map(mapRowToEtudiant));
  } catch (err) {
    console.error('[listEtudiants] ERREUR:', err.message);
    return res.status(500).json({ message: 'Erreur lors du chargement des étudiants.', detail: err.message });
  }
};


// ── POST /api/etudiants ───────────────────────────────────────────────────────
const inscrireEtudiant = async (req, res) => {
  let client;
  try {
    const {
      nom,
      prenoms,
      email,
      telephone,
      filiere,
      niveau,
      domaine,
      dateNaissance,
      adresse,
      nomParent,
      telParent,
      emailParent,
      nationalite,
      matricule: matriculeBody,
    } = req.body;

    if (!nom?.trim() || !prenoms?.trim()) {
      return res.status(400).json({ message: 'Nom et prénom requis.' });
    }
    if (!filiere?.trim()) {
      return res.status(400).json({ message: 'Filière requise.' });
    }

    client = await pool.connect();
    // Note: BEGIN/COMMIT ne fonctionnent pas avec Supabase RPC execute_sql
    // chaque requête est déjà atomique
    await ensureFilieres(client);

    const filiereRes = await client.query('SELECT id FROM filieres WHERE nom = $1', [filiere.trim()]);
    const filiereId = filiereRes.rows[0]?.id || null;

    const matricule = (matriculeBody?.trim().toUpperCase()) || (await generateMatricule(client));
    const emailFinal = email?.trim() || `${matricule.split('/')[1]}@ist.bf`;
    const domaineFinal = domaine?.trim() || domaineFromFiliere(filiere);

    // INSERT users sans RETURNING (non supporté par execute_sql Supabase)
    await client.query(
      `INSERT INTO users (
        matricule, nom, prenoms, email, tel, role, statut, mot_de_passe,
        domaine, niveau, date_naissance, nationalite, adresse,
        nom_parent, tel_parent, email_parent, etudiant_role, filiere_nom
      ) VALUES (
        $1, $2, $3, $4, $5, 'etudiant', 'actif', NULL,
        $6, $7, $8, $9, $10,
        $11, $12, $13, 'etudiant', $14
      )`,
      [
        matricule,
        nom.trim().toUpperCase(),
        prenoms.trim(),
        emailFinal,
        telephone?.trim() || null,
        domaineFinal,
        niveau?.trim() || null,
        dateNaissance?.trim() || null,
        nationalite?.trim() || 'Burkinabè',
        adresse?.trim() || null,
        nomParent?.trim() || null,
        telParent?.trim() || null,
        emailParent?.trim() || null,
        filiere.trim(),
      ]
    );

    // Récupérer l'ID de l'utilisateur inséré
    const userRow = await client.query('SELECT id FROM users WHERE matricule = $1', [matricule]);
    const userId = userRow.rows[0]?.id;
    if (!userId) throw new Error('Impossible de récupérer l\'ID utilisateur après insertion.');

    // INSERT etudiants sans RETURNING
    await client.query(
      `INSERT INTO etudiants (
        user_id, filiere_id, premierefois,
        matricule, nom, prenoms, email, tel,
        filiere_nom, domaine, niveau, date_naissance, nationalite,
        adresse, nom_parent, tel_parent, email_parent, statut
      ) VALUES (
        $1, $2, true,
        $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, 'actif'
      )`,
      [
        userId,
        filiereId,
        matricule,
        nom.trim().toUpperCase(),
        prenoms.trim(),
        emailFinal,
        telephone?.trim() || null,
        filiere.trim(),
        domaineFinal,
        niveau?.trim() || null,
        dateNaissance?.trim() || null,
        nationalite?.trim() || 'Burkinabè',
        adresse?.trim() || null,
        nomParent?.trim() || null,
        telParent?.trim() || null,
        emailParent?.trim() || null,
      ]
    );

    // Récupérer l'ID de l'étudiant inséré
    const etuRow = await client.query('SELECT id FROM etudiants WHERE user_id = $1', [userId]);
    const etuId = etuRow.rows[0]?.id;

    // Intégration groupe filière (non-bloquant, erreur ignorée)
    let groupesInfo = null;
    if (filiereId) {
      groupesInfo = await integrerDansGroupeFiliere(client, userId, filiereId, filiere.trim(), matricule);
    }
    // Pas de COMMIT car pas de BEGIN avec Supabase RPC

    // Notification best-effort
    let notifications = { sms: { envoye: false }, email: { envoye: false } };
    try {
      notifications = await notifierInscription({
        prenoms: prenoms.trim(),
        nom: nom.trim().toUpperCase(),
        matricule,
        email: email?.trim() || null,
        telephone: telephone?.trim() || null,
        ecole: filiere?.trim(),
      });
    } catch (notifErr) {
      console.error('[inscrireEtudiant] notification', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      matricule,
      notifications,
      groupes: groupesInfo,
      etudiant: {
        id: etuId,
        userId,
        matricule,
        nom: nom.trim().toUpperCase(),
        prenoms: prenoms.trim(),
        email: emailFinal,
        telephone: telephone?.trim() || '',
        filiere,
        filiereId,
        domaine: domaineFinal,
        niveau: niveau?.trim() || '',
        dateNaissance: dateNaissance?.trim() || '',
        nationalite: nationalite?.trim() || 'Burkinabè',
        adresse: adresse?.trim() || '',
        nomParent: nomParent?.trim() || '',
        telParent: telParent?.trim() || '',
        emailParent: emailParent?.trim() || '',
        statut: 'actif',
        role: 'etudiant',
      },
    });
  } catch (err) {
    // Pas de ROLLBACK car pas de BEGIN avec Supabase RPC
    console.error('[inscrireEtudiant]', err);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Matricule ou email déjà utilisé.' });
    }
    return res.status(500).json({ message: err.message || 'Erreur lors de l\'inscription.' });
  } finally {
    if (client) client.release();
  }
};

// ── POST /api/etudiants/finaliser ─────────────────────────────────────────────
const finaliserPremiereConnexion = async (req, res) => {
  const { matricule, id, email, telephone, password } = req.body;
  try {
    if (!password || password.trim().length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }

    let userRow = null;
    if (matricule) {
      const r = await pool.query(
        `SELECT u.*, e.id AS etudiant_id, e.filiere_id,
                COALESCE(e.filiere_nom, u.filiere_nom) AS filiere,
                COALESCE(e.niveau, u.niveau) AS niveau_etudiant
         FROM users u LEFT JOIN etudiants e ON u.id = e.user_id
         WHERE u.matricule = $1`,
        [matricule.toUpperCase()]
      );
      userRow = r.rows[0];
    } else if (id) {
      const r = await pool.query(
        `SELECT u.*, e.id AS etudiant_id, e.filiere_id,
                COALESCE(e.filiere_nom, u.filiere_nom) AS filiere,
                COALESCE(e.niveau, u.niveau) AS niveau_etudiant
         FROM users u LEFT JOIN etudiants e ON u.id = e.user_id
         WHERE u.id = $1`,
        [id]
      );
      userRow = r.rows[0];
    } else {
      return res.status(400).json({ error: 'Matricule ou ID requis.' });
    }

    if (!userRow) {
      return res.status(404).json({ error: 'Étudiant non trouvé.' });
    }

    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      'UPDATE users SET mot_de_passe = $1, email = COALESCE($2, email), tel = COALESCE($3, tel) WHERE id = $4',
      [hashed, email || null, telephone || null, userRow.id]
    );

    if (userRow.etudiant_id) {
      await pool.query(
        'UPDATE etudiants SET premierefois = false, email = COALESCE($1, email), tel = COALESCE($2, tel) WHERE id = $3',
        [email || null, telephone || null, userRow.etudiant_id]
      );
    }

    const token = jwt.sign(
      { id: userRow.id, matricule: userRow.matricule, role: userRow.role, filiere_id: userRow.filiere_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Compte activé avec succès.',
      token,
      user: {
        id: userRow.id,
        matricule: userRow.matricule,
        nom: userRow.nom,
        prenoms: userRow.prenoms,
        email: email || userRow.email || '',
        telephone: telephone || userRow.tel || '',
        filiere: userRow.filiere || '',
        filiere_id: userRow.filiere_id,
        niveau: userRow.niveau_etudiant || userRow.niveau || '',
        role: userRow.role || 'etudiant',
      }
    });
  } catch (err) {
    console.error('[finaliserPremiereConnexion]', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de l\'activation du compte.' });
  }
};

module.exports = { listEtudiants, inscrireEtudiant, finaliserPremiereConnexion };
