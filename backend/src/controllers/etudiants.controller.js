const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { ensureFilieres } = require('../utils/filieres');
const { synchroniserDeleguesCanaux } = require('../utils/canauxProfDelegue');
const { notifierInscription } = require('../services/inscription.notify');
const { envoyerNotificationAuto } = require('./notifications.controller');
const { genererProchainMatricule, validerMatricule, modeleValide } = require('../utils/matricule');

const domaineFromFiliere = (filiere) => {
  const f = (filiere || '').toLowerCase();
  if (f.includes('marketing') || f.includes('gestion') || f.includes('finance') || f.includes('comptab')) {
    return 'Sciences de Gestion';
  }
  return 'Sciences & Technologies';
};

// Ajoute « AND <alias>.etablissement_id = $N » seulement si l'établissement est connu.
const etabClause = (params, etabId, alias = 'u') => {
  if (!etabId) return '';
  params.push(etabId);
  return ` AND ${alias}.etablissement_id = $${params.length}`;
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
  sexe: row.sexe || '',
  regime: row.regime === 'soir' ? 'soir' : 'jour',
  lieuNaissance: row.lieu_naissance || '',
  urgenceNom: row.urgence_nom || '',
  urgenceTel: row.urgence_tel || '',
  urgenceLien: row.urgence_lien || '',
  photoUrl: row.photo_url || '',
  adresse: row.adresse || '',
  nomParent: row.nom_parent || '',
  telParent: row.tel_parent || '',
  emailParent: row.email_parent || '',
  statut: row.statut || 'actif',
  role: row.etudiant_role || 'etudiant',
  filiereRole: row.filiere_role || null,
  premiereFois: row.premierefois ?? true,
});

// ── Créer ou lier le compte parent (tuteur) à l'étudiant ──────────────────────
// Appelée à l'inscription d'un étudiant. Non-bloquant : une erreur ici ne doit
// jamais faire échouer l'inscription de l'étudiant lui-même.
// - Si un parent existe déjà avec ce téléphone (cas fratrie : même tuteur,
//   plusieurs enfants), on réutilise ce compte, on ne le duplique pas.
// - Sinon on crée un parent sans user_id (compte "en attente", comme les
//   professeurs avant leur première connexion) : il ne pourra se connecter
//   qu'après avoir défini son mot de passe via /api/parent/finaliser.
// - Le lien est figé : la contrainte UNIQUE(etudiant_id) sur parent_etudiants
//   garantit un seul tuteur principal par enfant. Toute correction ultérieure
//   passe par un écran admin dédié, pas par ce flux.
const creerOuLierParent = async (client, { nomParent, prenomParent, telParent, emailParent }, etuId) => {
  if (!telParent?.trim()) return null; // tuteur optionnel : pas de tel = on ignore

  try {
    const tel = telParent.trim();

    // 1. Chercher un parent existant avec ce téléphone
    const parentRes = await client.query('SELECT id FROM parents WHERE tel = $1', [tel]);
    let parentId;
    let lienExistant = false;

    if (parentRes.rows.length > 0) {
      parentId = parentRes.rows[0].id;
      lienExistant = true;
    } else {
      // 2. Créer le parent sans compte (user_id = null)
      const nouveau = await client.query(
        `INSERT INTO parents (nom, prenoms, tel, email, statut)
         VALUES ($1, $2, $3, $4, 'actif') RETURNING id`,
        [
          (nomParent?.trim() || '').toUpperCase(),
          prenomParent?.trim() || null,
          tel,
          emailParent?.trim() || null,
        ]
      );
      parentId = nouveau.rows[0].id;
    }

    // 3. Lier au nouvel étudiant (ON CONFLICT protège si un tuteur principal
    // existe déjà pour cet étudiant — ne devrait pas arriver à l'inscription
    // mais reste sûr en cas de double-appel)
    await client.query(
      `INSERT INTO parent_etudiants (parent_id, etudiant_id)
       VALUES ($1, $2) ON CONFLICT (etudiant_id) DO NOTHING`,
      [parentId, etuId]
    );

    return { parentId, lienExistant };
  } catch (err) {
    console.error('[creerOuLierParent] Erreur (non bloquante):', err.message);
    return null;
  }
};

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
        `INSERT INTO groupes (nom, type, filiere_id, description, created_at, etablissement_id)
         VALUES ($1, 'filiere', $2, $3, NOW(), (SELECT etablissement_id FROM filieres WHERE id = $2))
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
        `INSERT INTO groupes (nom, type, filiere_id, description, created_at, etablissement_id)
         VALUES ($1, 'admin_filiere', $2, $3, NOW(), (SELECT etablissement_id FROM filieres WHERE id = $2))
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
        u.id AS user_id,
        COALESCE(e.matricule, u.matricule) AS matricule,
        COALESCE(e.nom, u.nom) AS nom,
        COALESCE(e.prenoms, u.prenoms) AS prenoms,
        COALESCE(e.email, u.email) AS email,
        COALESCE(e.tel, u.tel) AS tel,
        COALESCE(u.statut, 'actif') AS statut,
        COALESCE(e.domaine, u.domaine) AS domaine,
        COALESCE(e.niveau, u.niveau) AS niveau,
        COALESCE(e.date_naissance, u.date_naissance) AS date_naissance,
        COALESCE(e.nationalite, u.nationalite, 'Burkinabè') AS nationalite,
        e.sexe AS sexe,
        COALESCE(e.regime, 'jour') AS regime,
        e.lieu_naissance AS lieu_naissance,
        e.urgence_nom AS urgence_nom,
        e.urgence_tel AS urgence_tel,
        e.urgence_lien AS urgence_lien,
        u.photo_url AS photo_url,
        COALESCE(e.adresse, u.adresse) AS adresse,
        COALESCE(e.nom_parent, u.nom_parent) AS nom_parent,
        COALESCE(e.tel_parent, u.tel_parent) AS tel_parent,
        COALESCE(e.email_parent, u.email_parent) AS email_parent,
        u.etudiant_role,
        u.filiere_role,
        e.filiere_id,
        e.premierefois,
        COALESCE(e.filiere_nom, f.nom) AS filiere_nom
      FROM users u
      LEFT JOIN etudiants e ON u.id = e.user_id
      LEFT JOIN filieres f ON f.id = e.filiere_id
      WHERE (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%')
        AND COALESCE(u.statut, 'actif') <> 'en_attente'
    `;

    const params = [];
    queryText += etabClause(params, req.etablissementId);
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
      prenomParent,
      telParent,
      emailParent,
      nationalite,
      sexe,
      regime,
      lieuNaissance,
      urgenceNom,
      urgenceTel,
      urgenceLien,
      matricule: matriculeBody,
      anneeEntree,
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

    // La filière se cherche DANS l'établissement de l'admin (deux écoles peuvent avoir
    // une filière du même nom : sans ce filtre, l'étudiant était rattaché à celle de l'autre école).
    const pf = [filiere.trim()];
    const filiereRes = await client.query(
      `SELECT id FROM filieres WHERE LOWER(TRIM(nom)) = LOWER($1)${etabClause(pf, req.etablissementId, 'filieres')}`,
      pf
    );
    const filiereId = filiereRes.rows[0]?.id || null;
    if (!filiereId) {
      return res.status(400).json({ message: `Filière « ${filiere.trim()} » introuvable dans votre établissement.` });
    }

    // Matricule : saisi à la main (anciens étudiants) ou généré selon le modèle de
    // l'établissement (voir utils/matricule.js).
    const etabId = req.etablissementId || null;
    let modele = '';
    if (etabId) {
      const er = await client.query('SELECT modele_matricule FROM etablissements WHERE id = $1', [etabId]);
      modele = er.rows[0]?.modele_matricule || '';
    }
    let matricule = matriculeBody?.trim().toUpperCase();
    if (matricule) {
      const v = validerMatricule(modele, matricule);
      if (!v.ok) return res.status(400).json({ message: v.message });
      const dejaLa = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
      if (dejaLa.rows.length) return res.status(409).json({ message: 'Ce matricule existe déjà.' });
    } else {
      try {
        matricule = await genererProchainMatricule(client, etabId, { anneeEntree });
      } catch (e) {
        if (e.code === 'NO_ETAB' || e.code === 'NO_MODELE') return res.status(400).json({ message: e.message });
        throw e;
      }
    }
    const emailFinal = email?.trim() || `${matricule.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}@sans-email.scolarhub`;
    const domaineFinal = domaine?.trim() || domaineFromFiliere(filiere);

    // INSERT users sans RETURNING (non supporté par execute_sql Supabase)
    await client.query(
      `INSERT INTO users (
        matricule, nom, prenoms, email, tel, role, statut, mot_de_passe,
        domaine, niveau, date_naissance, nationalite, adresse,
        nom_parent, tel_parent, email_parent, etudiant_role, filiere_nom, etablissement_id
      ) VALUES (
        $1, $2, $3, $4, $5, 'etudiant', 'actif', NULL,
        $6, $7, $8, $9, $10,
        $11, $12, $13, 'etudiant', $14, $15
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
        etabId,
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
        adresse, nom_parent, tel_parent, email_parent, statut, etablissement_id
      ) VALUES (
        $1, $2, true,
        $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, 'actif', $17
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
        etabId,
      ]
    );

    // Récupérer l'ID de l'étudiant inséré
    const etuRow = await client.query('SELECT id FROM etudiants WHERE user_id = $1', [userId]);
    const etuId = etuRow.rows[0]?.id;

    // Compléments d'identité (sexe, lieu de naissance, personne à prévenir).
    // Colonnes ajoutées par migration_etudiants_identite.sql ; non bloquant si absente.
    try {
      const sexeNorm = ['M', 'F'].includes(String(sexe || '').trim().toUpperCase())
        ? String(sexe).trim().toUpperCase() : null;
      await client.query(
        `UPDATE etudiants SET sexe = $1, lieu_naissance = $2, urgence_nom = $3,
                urgence_tel = $4, urgence_lien = $5, regime = $7 WHERE user_id = $6`,
        [
          sexeNorm,
          lieuNaissance?.trim() || null,
          urgenceNom?.trim() || null,
          urgenceTel?.trim() || null,
          urgenceLien?.trim() || null,
          userId,
          regime === 'soir' ? 'soir' : 'jour',
        ]
      );
    } catch (idErr) {
      console.error('[inscrireEtudiant] identité complémentaire (migration manquante ?)', idErr.message);
    }

    // Intégration groupe filière (non-bloquant, erreur ignorée)
    let groupesInfo = null;
    if (filiereId) {
      groupesInfo = await integrerDansGroupeFiliere(client, userId, filiereId, filiere.trim(), matricule);
    }

    // Créer/lier le compte parent (tuteur) — non-bloquant
    let parentInfo = null;
    if (etuId) {
      parentInfo = await creerOuLierParent(
        client,
        { nomParent, prenomParent, telParent, emailParent },
        etuId
      );
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

    // Notifier les autres étudiants déjà inscrits dans la même filière+niveau
    // qu'un nouveau camarade a rejoint — non-bloquant.
    if (filiereId && etuId) {
      try {
        const camarades = await client.query(
          `SELECT u.id FROM users u
           JOIN etudiants e ON e.user_id = u.id
           WHERE e.filiere_id = $1 AND e.niveau = $2 AND e.id != $3
             AND u.etablissement_id = (SELECT etablissement_id FROM filieres WHERE id = $1)
             AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%')
             AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye')`,
          [filiereId, niveau?.trim() || null, etuId]
        );
        const titreNouvel = 'Nouvel étudiant dans la filière';
        const corpsNouvel = `${prenoms.trim()} ${nom.trim().toUpperCase()} a rejoint ${filiere.trim()}${niveau ? ' — ' + niveau.trim() : ''}.`;
        for (const c of camarades.rows) {
          await envoyerNotificationAuto(c.id, titreNouvel, corpsNouvel, 'nouvel_etudiant', { etudiantId: etuId });
        }
      } catch (notifCamErr) {
        console.error('[inscrireEtudiant] notification camarades', notifCamErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      matricule,
      notifications,
      groupes: groupesInfo,
      parent: parentInfo,
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
        sexe: ['M', 'F'].includes(String(sexe || '').trim().toUpperCase()) ? String(sexe).trim().toUpperCase() : '',
        regime: regime === 'soir' ? 'soir' : 'jour',
        lieuNaissance: lieuNaissance?.trim() || '',
        urgenceNom: urgenceNom?.trim() || '',
        urgenceTel: urgenceTel?.trim() || '',
        urgenceLien: urgenceLien?.trim() || '',
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

    // Notification "bienvenue" — non-bloquant.
    envoyerNotificationAuto(
      userRow.id,
      'Bienvenue sur ScolarHub',
      'Votre compte a été activé avec succès. Bonne année académique !',
      'premiere_connexion',
      null
    ).catch(() => {});

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



  // ── GET /api/etudiants/delegues ────────────────────────────────────────────
// Liste complète de tous les délégués/adjoints de l'établissement (admin).
const getDelegues = async (req, res) => {
  try {
    const pr = [];
    const etabSql = etabClause(pr, req.etablissementId);
    const result = await pool.query(`
      SELECT u.id, u.nom, u.prenoms, u.matricule, u.etudiant_role,
             COALESCE(e.filiere_nom, u.filiere_nom) AS filiere_nom,
             COALESCE(e.niveau, u.niveau) AS niveau,
             COALESCE(e.domaine, u.domaine) AS domaine,
             e.filiere_id AS filiere_id
      FROM users u
      LEFT JOIN etudiants e ON u.id = e.user_id
      WHERE u.etudiant_role IN ('delegue', 'delegue_adjoint')${etabSql}
      ORDER BY COALESCE(e.filiere_nom, u.filiere_nom), COALESCE(e.niveau, u.niveau), u.etudiant_role, u.nom
    `, pr);
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getDelegues]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des délégués.' });
  }
};

// ── POST /api/etudiants/:id/nommer-delegue ─────────────────────────────────
// :id = id de la table etudiants (pas l'UUID users.id) — on résout d'abord
// le user_id correspondant avant de toucher à users.etudiant_role.
// body: { role: 'delegue' | 'delegue_adjoint', filiere_id, niveau }
// Un seul délégué ET un seul adjoint à la fois par (filière, niveau) : le
// titulaire précédent du même rôle est automatiquement rétrogradé.
const nommerDelegue = async (req, res) => {
  const { id } = req.params;
  const { role, filiere_id, niveau } = req.body;
  if (!['delegue', 'delegue_adjoint'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Rôle invalide.' });
  }
  if (!filiere_id || !niveau) {
    return res.status(400).json({ success: false, message: 'filiere_id et niveau requis.' });
  }
  const client = await pool.connect();
  try {
    const etuRes = await client.query('SELECT user_id FROM etudiants WHERE id = $1', [id]);
    const userId = etuRes.rows[0]?.user_id;
    if (!userId) {
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }

    await client.query(
      `UPDATE users u SET etudiant_role = NULL
       FROM etudiants e
       WHERE u.id = e.user_id
         AND u.etudiant_role = $1
         AND e.filiere_id::text = $2::text
         AND COALESCE(e.niveau, u.niveau) = $3
         AND u.id != $4`,
      [role, filiere_id, niveau, userId]
    );
    await client.query(`UPDATE users SET etudiant_role = $1 WHERE id = $2`, [role, userId]);
    // Le nouveau délégué rejoint les groupes des professeurs de sa classe
    // (et l'ancien titulaire en est retiré).
    try { await synchroniserDeleguesCanaux(filiere_id, niveau); }
    catch (e) { console.error('[nommerDelegue] sync canaux:', e.message); }
    return res.status(200).json({ success: true, message: 'Nomination effectuée.' });
  } catch (err) {
    console.error('[nommerDelegue]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la nomination.' });
  } finally {
    client.release();
  }
};

// ── PATCH /api/etudiants/:id/revoquer-delegue ──────────────────────────────
// :id = id de la table etudiants (pas l'UUID users.id).
const revoquerDelegue = async (req, res) => {
  const { id } = req.params;
  try {
    const etuRes = await pool.query('SELECT user_id FROM etudiants WHERE id = $1', [id]);
    const userId = etuRes.rows[0]?.user_id;
    if (!userId) {
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }
    const classeRes = await pool.query('SELECT filiere_id, niveau FROM etudiants WHERE id = $1', [id]);
    await pool.query(`UPDATE users SET etudiant_role = NULL WHERE id = $1`, [userId]);
    try { await synchroniserDeleguesCanaux(classeRes.rows[0]?.filiere_id, classeRes.rows[0]?.niveau); }
    catch (e) { console.error('[revoquerDelegue] sync canaux:', e.message); }
    return res.status(200).json({ success: true, message: 'Statut retiré.' });
  } catch (err) {
    console.error('[revoquerDelegue]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du retrait.' });
  }
};

// ── GET /api/etudiants/bde ──────────────────────────────────────────────────
// Liste établissement-wide du Bureau des Étudiants (président, adjoint,
// membres) — contrairement au délégué/adjoint, le BDE n'est pas scopé par
// filière/niveau : un seul président et un seul adjoint pour toute l'école.
const getBde = async (req, res) => {
  try {
    const pr = [];
    const etabSql = etabClause(pr, req.etablissementId);
    const result = await pool.query(`
      SELECT u.id, u.nom, u.prenoms, u.matricule, u.etudiant_role, u.photo_url,
             COALESCE(e.filiere_nom, u.filiere_nom) AS filiere_nom,
             COALESCE(e.niveau, u.niveau) AS niveau
      FROM users u
      LEFT JOIN etudiants e ON u.id = e.user_id
      WHERE u.etudiant_role IN ('bde_president', 'bde_adjoint', 'bde_membre')${etabSql}
      ORDER BY CASE u.etudiant_role
                 WHEN 'bde_president' THEN 0
                 WHEN 'bde_adjoint' THEN 1
                 ELSE 2
               END, u.nom
    `, pr);
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getBde]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du BDE.' });
  }
};

// ── POST /api/etudiants/:id/nommer-bde ──────────────────────────────────────
// :id = id de la table etudiants (pas l'UUID users.id).
// body: { role: 'bde_president' | 'bde_adjoint' | 'bde_membre' }
// Un seul président ET un seul adjoint à la fois pour TOUTE l'école (pas de
// scope filière/niveau, contrairement au délégué) — le titulaire précédent
// du même rôle est automatiquement rétrogradé. 'bde_membre' n'a pas cette
// contrainte : plusieurs membres simples peuvent coexister.
const nommerBde = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!['bde_president', 'bde_adjoint', 'bde_membre'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Rôle invalide.' });
  }
  const client = await pool.connect();
  try {
    const etuRes = await client.query('SELECT user_id FROM etudiants WHERE id = $1', [id]);
    const userId = etuRes.rows[0]?.user_id;
    if (!userId) {
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }

    if (role === 'bde_president' || role === 'bde_adjoint') {
      await client.query(
        `UPDATE users SET etudiant_role = NULL WHERE etudiant_role = $1 AND id != $2`,
        [role, userId]
      );
    }
    await client.query(`UPDATE users SET etudiant_role = $1 WHERE id = $2`, [role, userId]);
    return res.status(200).json({ success: true, message: 'Nomination effectuée.' });
  } catch (err) {
    console.error('[nommerBde]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la nomination.' });
  } finally {
    client.release();
  }
};

// ── PATCH /api/etudiants/:id/revoquer-bde ───────────────────────────────────
const revoquerBde = async (req, res) => {
  const { id } = req.params;
  try {
    const etuRes = await pool.query('SELECT user_id FROM etudiants WHERE id = $1', [id]);
    const userId = etuRes.rows[0]?.user_id;
    if (!userId) {
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }
    await pool.query(`UPDATE users SET etudiant_role = NULL WHERE id = $1`, [userId]);
    return res.status(200).json({ success: true, message: 'Statut retiré.' });
  } catch (err) {
    console.error('[revoquerBde]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du retrait.' });
  }
};

// ── PATCH /api/etudiants/:id/statut — Suspendre / réactiver un étudiant ────
// :id = id de la table etudiants (pas l'UUID users.id), mêmes conventions
// que nommerDelegue/revoquerDelegue ci-dessus.
// ⚠️ Avant cette fonction, "Suspendre" côté Flutter (admin_etudiants.dart)
// ne faisait qu'un setState() local — jamais persisté en base, et
// l'étudiant "suspendu" pouvait donc continuer à se connecter normalement
// (login() vérifie users.statut en base). Corrigé ici : les deux tables
// (users ET etudiants, qui dupliquent statut) sont mises à jour ensemble.
const changerStatutEtudiant = async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  const statutsValides = ['actif', 'suspendu', 'renvoye'];
  if (!statutsValides.includes(statut)) {
    return res.status(400).json({
      success: false,
      message: `Statut invalide. Valeurs autorisées : ${statutsValides.join(', ')}.`,
    });
  }
  try {
    const etuRes = await pool.query(
      'SELECT user_id, filiere_id, niveau, nom, prenoms FROM etudiants WHERE id = $1',
      [id]
    );
    const etu = etuRes.rows[0];
    if (!etu) {
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }

    await pool.query('UPDATE users SET statut = $1 WHERE id = $2', [statut, etu.user_id]);
    await pool.query('UPDATE etudiants SET statut = $1 WHERE id = $2', [statut, id]);

    // Notifier les camarades de filière+niveau en cas de suspension — non
    // bloquant.
    if (statut === 'suspendu' && etu.filiere_id) {
      try {
        const camarades = await pool.query(
          `SELECT u.id FROM users u
           JOIN etudiants e ON e.user_id = u.id
           WHERE e.filiere_id = $1 AND e.niveau = $2 AND e.id != $3
             AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%')
             AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye')`,
          [etu.filiere_id, etu.niveau, id]
        );
        const titre = 'Étudiant suspendu';
        const corps = `${etu.prenoms} ${etu.nom} a été suspendu(e) de la filière.`;
        for (const c of camarades.rows) {
          await envoyerNotificationAuto(c.id, titre, corps, 'suspension', null);
        }
      } catch (notifErr) {
        console.error('[changerStatutEtudiant] notification', notifErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: statut === 'actif' ? 'Étudiant réactivé.' : `Étudiant ${statut === 'suspendu' ? 'suspendu' : 'renvoyé'}.`,
    });
  } catch (err) {
    console.error('[changerStatutEtudiant]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du changement de statut.' });
  }
};

// GET /api/etudiants/stats/inscriptions (admin) — inscriptions groupées par
// mois + domaine, depuis la date réelle de création du compte (users.created_at).
// Sert à la fois à la courbe mensuelle de l'année en cours et à l'historique
// pluriannuel — le Flutter agrège selon le besoin. Ne renvoie que les mois où
// il existe réellement des inscriptions (pas de mois inventés à zéro).
const getStatsInscriptions = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DATE_TRUNC('month', u.created_at) AS mois, f.domaine,
             COALESCE(e.filiere_nom, f.nom) AS filiere_nom, COUNT(*) AS total
      FROM users u
      JOIN etudiants e ON e.user_id = u.id
      LEFT JOIN filieres f ON f.id = e.filiere_id
      WHERE u.created_at IS NOT NULL
      GROUP BY DATE_TRUNC('month', u.created_at), f.domaine, COALESCE(e.filiere_nom, f.nom)
      ORDER BY mois
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[getStatsInscriptions]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du calcul des statistiques.' });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// Matricule automatique, inscription temporaire des anciens, validation admin
// ═════════════════════════════════════════════════════════════════════════════
const UUID_RE = /^[A-Za-z0-9-]{8,64}$/;

async function estSuperAdmin(userId) {
  const r = await pool.query('SELECT role, admin_sub_role FROM users WHERE id = $1', [userId]);
  if (!r.rows.length) return false;
  const role = String(r.rows[0].role || '').toLowerCase();
  const sub = String(r.rows[0].admin_sub_role || '').toLowerCase().replace(/[\s-]/g, '_');
  return role === 'super_admin' || (role === 'admin' && sub.includes('super'));
}

// GET /api/etudiants/prochain-matricule?anneeEntree=2026  (admin)
// Aperçu du prochain matricule libre — pour le bouton « Générer automatiquement ».
const prochainMatricule = async (req, res) => {
  try {
    const matricule = await genererProchainMatricule(pool, req.etablissementId, { anneeEntree: req.query.anneeEntree });
    const er = await pool.query('SELECT modele_matricule FROM etablissements WHERE id = $1', [req.etablissementId]);
    return res.status(200).json({ success: true, matricule, modele: er.rows[0]?.modele_matricule || '' });
  } catch (err) {
    if (err.code === 'NO_ETAB' || err.code === 'NO_MODELE') {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('[prochainMatricule]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la génération du matricule.' });
  }
};

// GET /api/etudiants/parametres-inscription (admin)
const getParametresInscription = async (req, res) => {
  try {
    if (!req.etablissementId) return res.status(400).json({ success: false, message: 'Établissement inconnu. Reconnectez-vous.' });
    const r = await pool.query(
      'SELECT modele_matricule, inscription_ouverte, inscription_validation FROM etablissements WHERE id = $1',
      [req.etablissementId]
    );
    const e = r.rows[0] || {};
    return res.status(200).json({
      success: true,
      modeleMatricule: e.modele_matricule || '',
      inscriptionOuverte: e.inscription_ouverte === true,
      inscriptionValidation: e.inscription_validation !== false,
    });
  } catch (err) {
    console.error('[getParametresInscription]', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// PUT /api/etudiants/parametres-inscription (Super Admin)
// body: { inscriptionOuverte?: bool, inscriptionValidation?: bool, modeleMatricule?: string }
const setParametresInscription = async (req, res) => {
  try {
    if (!req.etablissementId) return res.status(400).json({ success: false, message: 'Établissement inconnu. Reconnectez-vous.' });
    if (!(await estSuperAdmin(req.user.id))) {
      return res.status(403).json({ success: false, message: 'Réservé au Super Admin.' });
    }
    const sets = [];
    const params = [];
    if (typeof req.body.inscriptionOuverte === 'boolean') {
      params.push(req.body.inscriptionOuverte); sets.push(`inscription_ouverte = $${params.length}`);
    }
    if (typeof req.body.inscriptionValidation === 'boolean') {
      params.push(req.body.inscriptionValidation); sets.push(`inscription_validation = $${params.length}`);
    }
    if (typeof req.body.modeleMatricule === 'string') {
      const m = req.body.modeleMatricule.trim();
      if (m) {
        const v = modeleValide(m);
        if (!v.ok) return res.status(400).json({ success: false, message: v.message });
      }
      params.push(m); sets.push(`modele_matricule = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Rien à modifier.' });
    params.push(req.etablissementId);
    await pool.query(`UPDATE etablissements SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[setParametresInscription]', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// GET /api/etudiants/en-attente (admin) — auto-inscriptions à valider
const listerEnAttente = async (req, res) => {
  try {
    const params = [];
    const etabSql = etabClause(params, req.etablissementId);
    const r = await pool.query(
      `SELECT u.id, u.matricule, u.nom, u.prenoms, u.email, u.tel,
              COALESCE(e.filiere_nom, u.filiere_nom) AS filiere, COALESCE(e.niveau, u.niveau) AS niveau,
              u.nom_parent, u.tel_parent, u.created_at
       FROM users u LEFT JOIN etudiants e ON e.user_id = u.id
       WHERE u.statut = 'en_attente'${etabSql}
       ORDER BY u.created_at DESC`,
      params
    );
    return res.status(200).json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[listerEnAttente]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des inscriptions.' });
  }
};

// Récupère les comptes « en attente » ciblés (ids, ou tous si all=true).
async function chargerEnAttente(req) {
  const params = [];
  let where = "u.statut = 'en_attente'" + etabClause(params, req.etablissementId);
  if (!req.body.all) {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(String).filter((x) => UUID_RE.test(x));
    if (!ids.length) return [];
    where += ` AND u.id IN (${ids.map((id) => { params.push(id); return `$${params.length}`; }).join(', ')})`;
  }
  const r = await pool.query(
    `SELECT u.id, u.matricule, e.filiere_id, COALESCE(e.filiere_nom, u.filiere_nom) AS filiere
     FROM users u LEFT JOIN etudiants e ON e.user_id = u.id WHERE ${where}`,
    params
  );
  return r.rows;
}

// POST /api/etudiants/valider-inscriptions (admin) body: { ids: [...] } ou { all: true }
const validerInscriptions = async (req, res) => {
  try {
    const cibles = await chargerEnAttente(req);
    for (const c of cibles) {
      await pool.query("UPDATE users SET statut = 'actif' WHERE id = $1", [c.id]);
      await pool.query("UPDATE etudiants SET statut = 'actif' WHERE user_id = $1", [c.id]);
      if (c.filiere_id) {
        await integrerDansGroupeFiliere(pool, c.id, c.filiere_id, c.filiere || '', c.matricule);
      }
      envoyerNotificationAuto(
        c.id, 'Inscription validée',
        'Votre inscription a été validée par l\'administration. Vous pouvez maintenant vous connecter.',
        'inscription_validee', null
      ).catch(() => {});
    }
    return res.status(200).json({ success: true, valides: cibles.length });
  } catch (err) {
    console.error('[validerInscriptions]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la validation.' });
  }
};

// POST /api/etudiants/refuser-inscriptions (admin) body: { ids: [...] }
// Supprime la demande (le compte n'a jamais été actif) : l'étudiant pourra refaire sa demande.
const refuserInscriptions = async (req, res) => {
  try {
    req.body.all = false;
    const cibles = await chargerEnAttente(req);
    for (const c of cibles) {
      await pool.query('DELETE FROM etudiants WHERE user_id = $1', [c.id]);
      await pool.query("DELETE FROM users WHERE id = $1 AND statut = 'en_attente'", [c.id]);
    }
    return res.status(200).json({ success: true, refuses: cibles.length });
  } catch (err) {
    console.error('[refuserInscriptions]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du refus.' });
  }
};

// ── PUT /api/etudiants/:id/identite — compléter l'identité (carte d'étudiant) ──
// :id = id de la table etudiants. Sert aux étudiants inscrits avant l'ajout des champs
// sexe / lieu de naissance / personne à prévenir.
const completerIdentite = async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body || {};
    const p = [id];
    const check = await pool.query(
      `SELECT e.id FROM etudiants e JOIN users u ON u.id = e.user_id WHERE e.id = $1${etabClause(p, req.etablissementId, 'u')}`,
      p
    );
    if (!check.rows.length) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });

    const sexe = ['M', 'F'].includes(String(b.sexe || '').trim().toUpperCase())
      ? String(b.sexe).trim().toUpperCase() : null;
    const t = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
    await pool.query(
      `UPDATE etudiants SET sexe = $1, lieu_naissance = $2, date_naissance = $3, nationalite = $4,
              urgence_nom = $5, urgence_tel = $6, urgence_lien = $7 WHERE id = $8`,
      [sexe, t(b.lieuNaissance), t(b.dateNaissance), t(b.nationalite) || 'Burkinabè',
       t(b.urgenceNom), t(b.urgenceTel), t(b.urgenceLien), id]
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[completerIdentite]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour.' });
  }
};

// Vérifie que l'étudiant :id (table etudiants) appartient à l'établissement de l'admin.
const etudiantDeMonEtab = async (id, etabId) => {
  const p = [id];
  const r = await pool.query(
    `SELECT e.id, e.user_id FROM etudiants e JOIN users u ON u.id = e.user_id WHERE e.id = $1${etabClause(p, etabId, 'u')}`,
    p
  );
  return r.rows[0] || null;
};

// ── POST /api/etudiants/:id/photo — photo d'identité (facultative) ────────────
// Passe par upload.single('file') + uploadToCloudinary (voir etudiants.routes.js).
const uploaderPhotoEtudiant = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    const etu = await etudiantDeMonEtab(req.params.id, req.etablissementId);
    if (!etu) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    await pool.query('UPDATE users SET photo_url = $1 WHERE id = $2', [req.uploadedFileUrl, etu.user_id]);
    return res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (err) {
    console.error('[uploaderPhotoEtudiant]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement de la photo.' });
  }
};

// ── POST /api/etudiants/:id/document — CNIB / acte de naissance / autre ───────
// multipart : file + champ texte `type` ('cnib' | 'autre').
const ajouterDocumentEtudiant = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    const etu = await etudiantDeMonEtab(req.params.id, req.etablissementId);
    if (!etu) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    const type = ['cnib', 'autre'].includes(req.body?.type) ? req.body.type : 'autre';
    await pool.query(
      'INSERT INTO etudiant_documents (etudiant_id, type, nom_fichier, url) VALUES ($1, $2, $3, $4)',
      [etu.id, type, req.file?.originalname || null, req.uploadedFileUrl]
    );
    return res.status(201).json({ success: true, url: req.uploadedFileUrl });
  } catch (err) {
    console.error('[ajouterDocumentEtudiant]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement du document.' });
  }
};

// ── GET /api/etudiants/:id/documents ──────────────────────────────────────────
const listerDocumentsEtudiant = async (req, res) => {
  try {
    const etu = await etudiantDeMonEtab(req.params.id, req.etablissementId);
    if (!etu) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    const r = await pool.query(
      'SELECT id, type, nom_fichier, url, created_at FROM etudiant_documents WHERE etudiant_id = $1 ORDER BY created_at DESC',
      [etu.id]
    );
    return res.status(200).json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[listerDocumentsEtudiant]', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des documents.' });
  }
};

// ── PUT /api/etudiants/:id — modifier la fiche d'un étudiant ──────────────────
// :id = id de la table etudiants. Seuls les champs présents dans le body sont modifiés.
// Le matricule n'est jamais modifiable ici.
const modifierEtudiant = async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body || {};
    const etu = await etudiantDeMonEtab(id, req.etablissementId);
    if (!etu) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });

    const t = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    if (has('nom') && !t(b.nom)) return res.status(400).json({ success: false, message: 'Le nom ne peut pas être vide.' });
    if (has('prenoms') && !t(b.prenoms)) return res.status(400).json({ success: false, message: 'Les prénoms ne peuvent pas être vides.' });

    // Filière (par nom, dans l'établissement) -> filiere_id / filiere_nom / domaine
    let filiereId = null; let filiereNom = null; let domaine = null;
    if (has('filiere') && t(b.filiere)) {
      const pf = [t(b.filiere)];
      const fr = await pool.query(
        `SELECT id, nom FROM filieres WHERE LOWER(TRIM(nom)) = LOWER($1)${etabClause(pf, req.etablissementId, 'filieres')}`, pf
      );
      if (!fr.rows[0]) return res.status(400).json({ success: false, message: 'Filière introuvable dans votre établissement.' });
      filiereId = fr.rows[0].id; filiereNom = fr.rows[0].nom; domaine = domaineFromFiliere(filiereNom);
    }

    const sets = []; const vals = [];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    const setsU = []; const valsU = [];
    const addU = (col, v) => { valsU.push(v); setsU.push(`${col} = $${valsU.length}`); };
    const both = (col, v) => { add(col, v); addU(col, v); };

    if (has('nom')) both('nom', t(b.nom).toUpperCase());
    if (has('prenoms')) both('prenoms', t(b.prenoms));
    if (has('email') && t(b.email)) both('email', t(b.email));
    if (has('telephone')) both('tel', t(b.telephone));
    if (has('adresse')) both('adresse', t(b.adresse));
    if (has('niveau')) both('niveau', t(b.niveau));
    if (has('dateNaissance')) both('date_naissance', t(b.dateNaissance));
    if (has('nationalite')) both('nationalite', t(b.nationalite) || 'Burkinabè');
    if (has('nomParent')) both('nom_parent', t(b.nomParent));
    if (has('telParent')) both('tel_parent', t(b.telParent));
    if (has('emailParent')) both('email_parent', t(b.emailParent));
    if (filiereId) {
      add('filiere_id', filiereId); both('filiere_nom', filiereNom); both('domaine', domaine);
    }
    if (has('sexe')) add('sexe', ['M', 'F'].includes(String(b.sexe).toUpperCase()) ? String(b.sexe).toUpperCase() : null);
    if (has('regime')) add('regime', b.regime === 'soir' ? 'soir' : 'jour');
    if (has('lieuNaissance')) add('lieu_naissance', t(b.lieuNaissance));
    if (has('urgenceNom')) add('urgence_nom', t(b.urgenceNom));
    if (has('urgenceTel')) add('urgence_tel', t(b.urgenceTel));
    if (has('urgenceLien')) add('urgence_lien', t(b.urgenceLien));

    if (!sets.length) return res.status(400).json({ success: false, message: 'Rien à modifier.' });
    vals.push(etu.id);
    await pool.query(`UPDATE etudiants SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    if (setsU.length) {
      valsU.push(etu.user_id);
      await pool.query(`UPDATE users SET ${setsU.join(', ')} WHERE id = $${valsU.length}`, valsU);
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[modifierEtudiant]', err);
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé.' });
    return res.status(500).json({ success: false, message: 'Erreur lors de la modification.' });
  }
};

module.exports = {
  modifierEtudiant,
  uploaderPhotoEtudiant,
  ajouterDocumentEtudiant,
  listerDocumentsEtudiant,
  completerIdentite,
  listEtudiants,
  inscrireEtudiant,
  finaliserPremiereConnexion,
  getDelegues,
  nommerDelegue,
  revoquerDelegue,
  getBde,
  nommerBde,
  revoquerBde,
  changerStatutEtudiant,
  getStatsInscriptions,
  prochainMatricule,
  getParametresInscription,
  setParametresInscription,
  listerEnAttente,
  validerInscriptions,
  refuserInscriptions,
};