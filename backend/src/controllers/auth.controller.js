const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const supabase = require('../config/supabase');
const crypto = require('crypto');
const emailService = require('../services/email.service');
const { envoyerNotificationAuto } = require('./notifications.controller');
const { validerMatricule } = require('../utils/matricule');

// ── Multi-établissement ─────────────────────────────────────────────────────
// L'établissement est désigné par son CODE (saisi à l'ouverture de l'app) ou,
// à défaut, par son id. Tant que l'app Flutter n'envoie ni l'un ni l'autre, on
// ne filtre pas (comportement historique) — voir le log [ETAB].
async function resolveEtablissement(req) {
  const src = { ...(req.query || {}), ...(req.body || {}) };
  const code = String(src.code_etablissement || src.codeEtablissement || src.etablissement_code || '').trim();
  const idBrut = src.etablissement_id || src.etablissementId;
  try {
    if (code) {
      const r = await pool.query(
        'SELECT id FROM etablissements WHERE UPPER(code) = UPPER($1) AND COALESCE(actif, true) = true',
        [code]
      );
      return r.rows[0] ? { id: r.rows[0].id } : { invalide: true };
    }
    if (idBrut !== undefined && idBrut !== null && idBrut !== '') {
      const n = parseInt(idBrut, 10);
      if (Number.isInteger(n)) return { id: n };
    }
  } catch (e) {
    console.warn('[ETAB] résolution impossible :', e.message);
  }
  return { id: null };
}

// Réponse standard quand le code d'établissement n'est pas fourni.
const ETAB_REQUIS = {
  message: "Code d'établissement requis. Choisissez votre établissement.",
  code: 'ETAB_REQUIS',
};

// Ajoute « AND <alias>.etablissement_id = $N » (et le paramètre) seulement si
// un établissement est connu. Évite tout paramètre NULL.
function etabClause(params, etabId, alias = 'u') {
  if (!etabId) return '';
  params.push(etabId);
  return ` AND ${alias}.etablissement_id = $${params.length}`;
}

const genToken = (user) => jwt.sign(
  { id: user.id, matricule: user.matricule, role: user.role, filiere_id: user.filiere_id, etablissement_id: user.etablissement_id || null },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const login = async (req, res) => {
  try {
    const { matricule, nom, tel, motDePasse, password, userId, prenom, prenoms } = req.body;
    const mdp = password || motDePasse; // Accepter les deux formats
    let user = null;

    const etab = await resolveEtablissement(req);
    if (etab.invalide) return res.status(404).json({ message: 'Établissement introuvable.' });
    const etabId = etab.id;
    if (!etabId) return res.status(400).json(ETAB_REQUIS);

    try {
      if (userId) {
        const paramsId = [userId.toString()];
        const r = await pool.query(
          `SELECT u.*, e.filiere_id,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau) AS niveau_etudiant,
                  COALESCE(e.email, u.email) AS email_etudiant,
                  COALESCE(e.tel, u.tel) AS tel_etudiant,
                  COALESCE(adm.domaine_admin, adm.permissions->>'domaine', m.permissions->>'domaine', u.domaine_admin, 'Tous') AS admin_domaine,
                  COALESCE(p.matricule, p_etu.matricule) AS matricule_enfant,
                  CASE 
                    WHEN p_etu.nom IS NOT NULL THEN TRIM(COALESCE(p_etu.prenoms, '') || ' ' || p_etu.nom)
                    ELSE NULL 
                  END AS enfant_nom
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.tel, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND (p.etablissement_id IS NULL OR p.etablissement_id = u.etablissement_id)
           LEFT JOIN etudiants p_etu ON (p.matricule = p_etu.matricule OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND p_etu.etablissement_id = u.etablissement_id
           LEFT JOIN membres m ON u.id = m.user_id
           LEFT JOIN administrateurs adm ON (adm.user_id = u.id OR adm.email = u.email OR adm.tel = u.tel)
           WHERE u.id::text = $1${etabClause(paramsId, etabId)}`,
          paramsId
        );
        user = r.rows[0];
      } else if (matricule) {
        const matClean = matricule.trim().toLowerCase();
        const paramsMat = [matClean];
        const r = await pool.query(
          `SELECT u.*, e.filiere_id,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau) AS niveau_etudiant,
                  COALESCE(e.email, u.email) AS email_etudiant,
                  COALESCE(e.tel, u.tel) AS tel_etudiant,
                  COALESCE(adm.domaine_admin, adm.permissions->>'domaine', m.permissions->>'domaine', u.domaine_admin, 'Tous') AS admin_domaine,
                  COALESCE(p.matricule, p_etu.matricule) AS matricule_enfant,
                  CASE 
                    WHEN p_etu.nom IS NOT NULL THEN TRIM(COALESCE(p_etu.prenoms, '') || ' ' || p_etu.nom)
                    ELSE NULL 
                  END AS enfant_nom
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.tel, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND (p.etablissement_id IS NULL OR p.etablissement_id = u.etablissement_id)
           LEFT JOIN etudiants p_etu ON (p.matricule = p_etu.matricule OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND p_etu.etablissement_id = u.etablissement_id
           LEFT JOIN membres m ON u.id = m.user_id
           LEFT JOIN administrateurs adm ON (adm.user_id = u.id OR adm.email = u.email OR adm.tel = u.tel)
           WHERE (LOWER(u.matricule) = $1 OR LOWER(u.email) = $1)${etabClause(paramsMat, etabId)}`,
          paramsMat
        );
        user = r.rows[0];
      } else if (nom && (tel || req.body.telephone)) {
        const telVal = (tel || req.body.telephone).trim().replace(/\s+/g, '');
        const prenomVal = (prenom || prenoms || req.body.prenom || req.body.prenoms || '').trim();
        const paramsNom = prenomVal
          ? [nom.trim(), telVal, `%${telVal}%`, prenomVal, `%${prenomVal}%`]
          : [nom.trim(), telVal, `%${telVal}%`];
        const etabSqlNom = etabClause(paramsNom, etabId);
        const r = await pool.query(
          `SELECT u.*, e.filiere_id,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau) AS niveau_etudiant,
                  COALESCE(e.email, u.email) AS email_etudiant,
                  COALESCE(e.tel, u.tel) AS tel_etudiant,
                  COALESCE(adm.domaine_admin, adm.permissions->>'domaine', m.permissions->>'domaine', u.domaine_admin, 'Tous') AS admin_domaine,
                  COALESCE(p.matricule, p_etu.matricule) AS matricule_enfant,
                  CASE 
                    WHEN p_etu.nom IS NOT NULL THEN TRIM(COALESCE(p_etu.prenoms, '') || ' ' || p_etu.nom)
                    ELSE NULL 
                  END AS enfant_nom
           FROM users u 
           LEFT JOIN etudiants e ON u.id = e.user_id 
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.tel, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND (p.etablissement_id IS NULL OR p.etablissement_id = u.etablissement_id)
           LEFT JOIN etudiants p_etu ON (p.matricule = p_etu.matricule OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND p_etu.etablissement_id = u.etablissement_id
           LEFT JOIN membres m ON u.id = m.user_id
           LEFT JOIN administrateurs adm ON (adm.user_id = u.id OR adm.email = u.email OR adm.tel = u.tel)
           WHERE LOWER(TRIM(u.nom)) = LOWER(TRIM($1)) 
             AND (REPLACE(COALESCE(u.tel, ''), ' ', '') = $2 OR REPLACE(COALESCE(u.tel, ''), ' ', '') LIKE $3)
             ${prenomVal ? "AND (LOWER(TRIM(u.prenoms)) = LOWER(TRIM($4)) OR LOWER(u.prenoms) LIKE $5)" : ""}${etabSqlNom}`,
          paramsNom
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
        if (etabId) query = query.eq('etablissement_id', etabId);
        const { data, error } = await query.maybeSingle();
        if (!error && data) {
          user = data;
        }
      }
    }

    // ── Fallback 2 : chercher directement dans administrateurs si pas trouvé ──
    // (cas des admins créés uniquement dans Supabase, sans entrée dans users)
    if (!user) {
      try {
        let admQuery = supabase.from('administrateurs')
          .select('id, nom, prenoms, email, tel, matricule, role, admin_sub_role, statut, mot_de_passe, permissions, domaine_admin');
        if (matricule) {
          const matClean = matricule.trim().toLowerCase();
          admQuery = admQuery.or(`matricule.ilike.${matClean},email.ilike.${matClean}`);
        } else if (nom && tel) {
          const telClean = tel.trim().replace(/\s+/g, '');
          admQuery = admQuery.ilike('nom', `%${nom.trim()}%`).or(`tel.eq.${telClean},tel.ilike.%25${telClean}%25`);
        }
        if (etabId) admQuery = admQuery.eq('etablissement_id', etabId);
        const { data: admData, error: admErr } = await admQuery.limit(1);
        const adm = Array.isArray(admData) ? admData[0] : admData;
        if (!admErr && adm) {
          const perms = typeof adm.permissions === 'string' ? JSON.parse(adm.permissions || '{}') : (adm.permissions || {});
          user = {
            ...adm,
            role: adm.role || 'admin',
            admin_sub_role: adm.admin_sub_role || perms.role || 'Administration',
            admin_domaine: adm.domaine_admin || perms.domaine || 'Tous',
            statut: adm.statut || 'actif',
          };
          console.log('[LOGIN] Trouvé dans administrateurs :', adm.nom, adm.matricule);
        }
      } catch (admErr2) {
        console.warn('[LOGIN] Fallback administrateurs échoué :', admErr2.message);
      }
    }

    // ── Fallback 3 : parent pas encore matérialisé en `users` ──────────────────
    // Un parent créé à l'inscription d'un étudiant n'a QUE sa ligne dans
    // `parents` (user_id = null) tant qu'il ne s'est jamais connecté. Il ne
    // peut donc pas être trouvé dans `users` par les recherches ci-dessus.
    // On le cherche ici directement dans `parents` par nom+prénom+téléphone.
    // S'il est trouvé sans user_id, on renvoie le signal de première
    // connexion — la création réelle du `users` se fait dans
    // parent.controller.js::finaliserPremiereConnexionParent.
    if (!user && nom && (tel || req.body.telephone)) {
      const telClean = (tel || req.body.telephone).trim().replace(/\s+/g, '');
      const prenomVal = (prenom || prenoms || req.body.prenom || req.body.prenoms || '').trim();
      try {
        const paramsPar = prenomVal ? [nom.trim(), telClean, prenomVal] : [nom.trim(), telClean];
        const etabSqlPar = etabClause(paramsPar, etabId, 'parents');
        const pRes = await pool.query(
          `SELECT id, nom, prenoms, tel, email, user_id
           FROM parents
           WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))
             AND REPLACE(COALESCE(tel,''), ' ', '') = $2
             ${prenomVal ? "AND LOWER(TRIM(prenoms)) = LOWER(TRIM($3))" : ""}${etabSqlPar}`,
          paramsPar
        );
        const p = pRes.rows[0];
        if (p && !p.user_id) {
          // Parent connu, jamais connecté : signal première connexion
          return res.status(200).json({
            premiereFois: true,
            parent: {
              parentId: p.id,
              nom: p.nom,
              prenoms: p.prenoms,
              telephone: p.tel,
              email: p.email || '',
              role: 'parent',
            },
          });
        }
        // Si p existe ET a déjà un user_id, on laisse la suite gérer via `users`
        // (cas normal déjà couvert par la recherche nom+tel ci-dessus, donc on
        // ne fait rien de plus ici — cette branche ne devrait pas arriver).
      } catch (e) {
        console.warn('[LOGIN] Fallback parents:', e.message);
      }
    }

    if (!user) return res.status(404).json({ message: 'Matricule non reconnu.' });
    if (user.statut === 'suspendu') return res.status(403).json({ message: 'Compte suspendu.' });
    if (user.statut === 'renvoye') return res.status(403).json({ message: 'Compte desactive.' });
    if (user.statut === 'en_attente') return res.status(403).json({ message: "Votre inscription est en attente de validation par l'administration." });

    const motDePasseExiste = user.mot_de_passe && user.mot_de_passe.trim() !== '' && user.mot_de_passe !== 'null';
    const isFirstTimeRole = !user.role || user.role === 'etudiant' || user.role === 'bde' || user.role === 'parent' || user.role === 'professeur';
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
            role: (user.role === 'etudiant' && user.etudiant_role) ? user.etudiant_role : (user.role || 'etudiant'),
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

    if (!user.etablissement_id) {
      return res.status(403).json({ message: "Ce compte n'est rattaché à aucun établissement. Contactez l'administration." });
    }
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
           AND (REPLACE(COALESCE(tel,''),' ','') = $2
            OR LOWER(nom) = LOWER($3))`,
        [safeUser.id, telClean, safeUser.nom || '']
      ).catch(e => console.warn('[LOGIN] Sync parents.user_id:', e.message));
    }

    const responseUser = {
      ...safeUser,
      // ✅ CORRIGÉ — le rôle générique du compte (users.role, toujours
      // 'etudiant' pour un élève) écrasait le rôle spécifique de l'élève
      // (users.etudiant_role : 'delegue', 'bde_president', etc.), envoyé à
      // Flutter dans le champ que StudentProfile.role attend précisément
      // pour ce rôle spécifique. Résultat : un président BDE fraîchement
      // nommé restait "etudiant" simple à ses yeux même après reconnexion,
      // et ne pouvait jamais écrire dans le canal BDE (peutEcrireBDE testait
      // ce champ). On préfère désormais etudiant_role quand il existe pour
      // un compte de type étudiant ; les autres types de compte (admin,
      // professeur, parent) ne sont pas concernés.
      role: (safeUser.role === 'etudiant' && safeUser.etudiant_role)
        ? safeUser.etudiant_role
        : (safeUser.role || 'etudiant'),
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
      await pool.query('UPDATE users SET mot_de_passe = $1, email = COALESCE($2, email) WHERE id = $3', [hashed, email || null, userId]);
    } catch (dbErr) {
      if (supabase && typeof supabase.from === 'function') {
        await supabase.from('users').update(email ? { mot_de_passe: hashed, email } : { mot_de_passe: hashed }).eq('id', userId);
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

    const etab = await resolveEtablissement(req);
    if (etab.invalide) return res.status(404).json({ found: false, message: 'Établissement introuvable.' });
    const etabId = etab.id;
    if (!etabId) return res.status(400).json({ found: false, ...ETAB_REQUIS });

    if (matricule) {
      try {
        const paramsLk = [matricule];
        const r = await pool.query(
          `SELECT u.id, u.nom, u.prenoms, u.matricule, u.role, u.admin_sub_role, u.statut,
                  u.mot_de_passe IS NOT NULL AND u.mot_de_passe != '' AND u.mot_de_passe != 'null' AS a_mot_de_passe,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere_nom,
                  COALESCE(e.domaine, p_etu.domaine, u.domaine)        AS domaine,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau)          AS niveau,
                  COALESCE(e.regime, 'jour') AS regime, e.sexe AS sexe,
                  COALESCE(e.nationalite, u.nationalite) AS nationalite,
                  COALESCE(e.date_naissance, u.date_naissance) AS date_naissance,
                  e.lieu_naissance AS lieu_naissance,
                  COALESCE(e.email, u.email) AS email_aff, COALESCE(e.tel, u.tel) AS tel_aff,
                  COALESCE(p.matricule, p_etu.matricule) AS matricule_enfant,
                  p_etu.nom AS enfant_nom,
                  p_etu.prenoms AS enfant_prenoms
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.tel, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND (p.etablissement_id IS NULL OR p.etablissement_id = u.etablissement_id)
           LEFT JOIN etudiants p_etu ON (p.matricule = p_etu.matricule OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND p_etu.etablissement_id = u.etablissement_id
           WHERE (UPPER(TRIM(u.matricule)) = $1 OR LOWER(TRIM(u.email)) = LOWER(TRIM($1)))${etabClause(paramsLk, etabId)}`,
          paramsLk
        );
        row = r.rows[0];
      } catch (dbErr) {
        console.warn('Direct PG failed in lookup by matricule, fallback to Supabase SDK:', dbErr.message);
        if (supabase && typeof supabase.from === 'function') {
          const { data, error } = await supabase
            .from('users')
            .select('id, nom, prenoms, matricule, role, admin_sub_role, statut, mot_de_passe, filiere_nom, domaine, niveau')
            .eq('matricule', matricule)
            .match(etabId ? { etablissement_id: etabId } : {})
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
        const telNet = tel.trim().replace(/\s+/g, '');
        const paramsLd = [nom.trim(), prenom.trim(), `%${prenom.trim()}%`, telNet, `%${telNet}%`];
        const etabSqlLd = etabClause(paramsLd, etabId);
        const r = await pool.query(
          `SELECT u.id, u.nom, u.prenoms, u.matricule, u.role, u.admin_sub_role, u.statut,
                  u.mot_de_passe IS NOT NULL AND u.mot_de_passe != '' AND u.mot_de_passe != 'null' AS a_mot_de_passe,
                  COALESCE(e.filiere_nom, p_etu.filiere_nom, u.filiere_nom) AS filiere_nom,
                  COALESCE(e.domaine, p_etu.domaine, u.domaine)        AS domaine,
                  COALESCE(e.niveau, p_etu.niveau, u.niveau)          AS niveau,
                  COALESCE(e.regime, 'jour') AS regime, e.sexe AS sexe,
                  COALESCE(e.nationalite, u.nationalite) AS nationalite,
                  COALESCE(e.date_naissance, u.date_naissance) AS date_naissance,
                  e.lieu_naissance AS lieu_naissance,
                  COALESCE(e.email, u.email) AS email_aff, COALESCE(e.tel, u.tel) AS tel_aff,
                  COALESCE(p.matricule, p_etu.matricule) AS matricule_enfant,
                  p_etu.nom AS enfant_nom,
                  p_etu.prenoms AS enfant_prenoms
           FROM users u
           LEFT JOIN etudiants e ON u.id = e.user_id
           LEFT JOIN parents p ON (p.user_id = u.id OR REPLACE(COALESCE(p.tel, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND (p.etablissement_id IS NULL OR p.etablissement_id = u.etablissement_id)
           LEFT JOIN etudiants p_etu ON (p.matricule = p_etu.matricule OR REPLACE(COALESCE(p_etu.tel_parent, ''), ' ', '') = REPLACE(COALESCE(u.tel, ''), ' ', '')) AND p_etu.etablissement_id = u.etablissement_id
           WHERE LOWER(TRIM(u.nom)) = LOWER(TRIM($1))
             AND (LOWER(TRIM(u.prenoms)) = LOWER(TRIM($2)) OR LOWER(u.prenoms) LIKE LOWER($3) OR LOWER(u.nom) LIKE LOWER($3))
             AND (REPLACE(COALESCE(u.tel, ''), ' ', '') = $4 OR REPLACE(COALESCE(u.tel, ''), ' ', '') LIKE $5 OR $4 LIKE ('%' || REPLACE(COALESCE(u.tel, ''), ' ', '') || '%'))${etabSqlLd}`,
          paramsLd
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
            .match(etabId ? { etablissement_id: etabId } : {})
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

    // ── Fallback : parent pas encore matérialisé en `users` ─────────────────
    // Même situation que dans login() : un parent créé à l'inscription d'un
    // étudiant n'a que sa ligne dans `parents` (user_id = null) tant qu'il ne
    // s'est jamais connecté. Le flux Flutter "Nom & Prénom" (profs ET
    // parents) passe par CETTE fonction (lookup), pas par login() — le
    // fallback doit donc exister ici aussi, avec la même logique.
    if (!row && nom && prenom && tel) {
      const telClean = tel.trim().replace(/\s+/g, '');
      try {
        const paramsLp = [nom.trim(), prenom.trim(), telClean];
        const etabSqlLp = etabClause(paramsLp, etabId, 'parents');
        const pRes = await pool.query(
          `SELECT id, nom, prenoms, tel, email, user_id
           FROM parents
           WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))
             AND LOWER(TRIM(prenoms)) = LOWER(TRIM($2))
             AND REPLACE(COALESCE(tel,''), ' ', '') = $3${etabSqlLp}`,
          paramsLp
        );
        const p = pRes.rows[0];
        if (p && !p.user_id) {
          return res.status(200).json({
            found: true,
            premierLogin: true,
            userId: null,
            parentId: p.id,
            user: {
              id: null,
              nom: p.nom,
              prenoms: p.prenoms,
              matricule: '',
              role: 'parent',
              admin_sub_role: null,
              filiere: '',
              domaine: '',
              niveau: '',
              enfant_nom: '',
              matricule_enfant: '',
            },
          });
        }
      } catch (e) {
        console.warn('[LOOKUP] Fallback parents:', e.message);
      }
    }

    if (!row) return res.status(404).json({ found: false, message: 'Utilisateur non reconnu.' });
    if (row.statut === 'suspendu' || row.statut === 'renvoye') {
      return res.status(403).json({ found: false, message: 'Compte désactivé. Contactez l\'administration.' });
    }

    const enfantNomComplet = (row.enfant_prenoms || row.enfant_nom)
      ? `${row.enfant_prenoms || ''} ${row.enfant_nom || ''}`.trim()
      : (row.enfant_nom || '');

    // Première connexion d'un étudiant : on affiche aussi quelques informations de son
    // inscription pour qu'il se reconnaisse. Endpoint public → email / téléphone masqués
    // et date de naissance limitée à l'année.
    const masquerEmail = (e) => {
      if (!e || /@sans-email\.scolarhub$/i.test(e) || !e.includes('@')) return '';
      const [l, d] = e.split('@');
      return `${l.slice(0, 1)}${'*'.repeat(Math.max(l.length - 1, 2))}@${d}`;
    };
    const masquerTel = (t) => {
      const c = String(t || '').replace(/\s+/g, '');
      return c.length < 4 ? '' : `${'*'.repeat(c.length - 2)}${c.slice(-2)}`;
    };
    const detailsEtudiant = (!row.a_mot_de_passe && row.role === 'etudiant')
      ? {
          email: masquerEmail(row.email_aff),
          telephone: masquerTel(row.tel_aff),
          regime: row.regime === 'soir' ? 'soir' : 'jour',
          sexe: row.sexe || '',
          nationalite: row.nationalite || '',
          annee_naissance: row.date_naissance ? String(row.date_naissance).slice(0, 4) : '',
          lieu_naissance: row.lieu_naissance || '',
        }
      : {};

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
        ...detailsEtudiant,
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
      `SELECT u.id, u.nom, u.prenoms, u.matricule, u.email, u.tel, u.role, u.etudiant_role, u.statut,
              u.adresse, u.attestation_url, u.langue, u.notifications_actives,
              u.etablissement_id, e.filiere_id
       FROM users u LEFT JOIN etudiants e ON u.id = e.user_id WHERE u.id = $1`,
      [req.user.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Introuvable.' });
    const row = r.rows[0];
    // ✅ CORRIGÉ — même correctif que dans login() : le rôle spécifique de
    // l'élève (etudiant_role : délégué, président BDE...) doit prévaloir
    // sur le rôle générique du compte pour les comptes étudiants, sinon
    // le profil rechargé au démarrage de l'app "efface" une nomination
    // qui venait d'avoir lieu.
    return res.status(200).json({
      ...row,
      role: (row.role === 'etudiant' && row.etudiant_role) ? row.etudiant_role : (row.role || 'etudiant'),
    });
  } catch (err) {
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── PATCH /api/auth/profil ──────────────────────────────────────────────
// Mise à jour partielle du profil connecté : adresse, préférences (langue,
// notifications). Chaque champ est optionnel — seuls ceux envoyés sont
// modifiés. Téléphone/email restent en lecture seule ici volontairement
// (déjà gérés par leurs propres flux existants ailleurs dans l'app).
const modifierProfil = async (req, res) => {
  try {
    const { adresse, langue, notifications_actives } = req.body;
    const champs = [];
    const valeurs = [];
    let i = 1;
    if (adresse !== undefined) { champs.push(`adresse = $${i++}`); valeurs.push(adresse); }
    if (langue !== undefined) { champs.push(`langue = $${i++}`); valeurs.push(langue); }
    if (notifications_actives !== undefined) { champs.push(`notifications_actives = $${i++}`); valeurs.push(notifications_actives); }
    if (champs.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun champ à mettre à jour.' });
    }
    valeurs.push(req.user.id);
    await pool.query(`UPDATE users SET ${champs.join(', ')} WHERE id = $${i}`, valeurs);
    res.status(200).json({ success: true, message: 'Profil mis à jour.' });
  } catch (err) {
    console.error('[modifierProfil]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du profil.' });
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
    if (String(nouveauMotDePasse).length < 8) {
      return res.status(400).json({ message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
    }
    if (nouveauMotDePasse === ancienMotDePasse) {
      return res.status(400).json({ message: "Le nouveau mot de passe doit être différent de l'ancien." });
    }
    const hashed = await bcrypt.hash(nouveauMotDePasse, 10);
    await pool.query('UPDATE users SET mot_de_passe = $1 WHERE id = $2', [hashed, req.user.id]);
    // Le mot de passe provisoire n'est plus à changer (colonne absente avant la migration : sans gravité).
    pool.query('UPDATE users SET mdp_a_changer = false WHERE id = $1', [req.user.id]).catch(() => {});
    envoyerNotificationAuto(
      req.user.id,
      'Mot de passe modifié',
      'Votre mot de passe a été changé avec succès. Si ce n\'était pas vous, contactez l\'administration immédiatement.',
      'mot_de_passe',
      null
    ).catch(() => {});
    return res.status(200).json({ message: 'Mot de passe mis a jour.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Limiteur simple en mémoire : 10 demandes d'inscription par heure et par IP.
const _tentativesInscription = new Map();
function tropDeDemandes(ip) {
  const now = Date.now();
  const fenetre = 60 * 60 * 1000;
  const liste = (_tentativesInscription.get(ip) || []).filter((t) => now - t < fenetre);
  liste.push(now);
  _tentativesInscription.set(ip, liste);
  return liste.length > 10;
}

// POST /api/auth/register — AUTO-INSCRIPTION TEMPORAIRE des anciens étudiants.
// Prévue pour être fermée (etablissements.inscription_ouverte = false) quand tous
// les anciens sont inscrits ; ensuite seule l'administration crée les étudiants.
// Le matricule est OBLIGATOIRE (jamais généré ici) et doit respecter le modèle de
// l'établissement. Par défaut le compte reste « en_attente » jusqu'à validation
// par l'administration (etablissements.inscription_validation).
const register = async (req, res) => {
  let client;
  try {
    if (tropDeDemandes(req.ip)) {
      return res.status(429).json({ message: 'Trop de tentatives. Réessayez plus tard.' });
    }
    const {
      nom, prenoms, email, telephone, motDePasse, matricule: matriculeBody, filiere, niveau,
      nomPersonne, telPersonne,
    } = req.body;

    if (!nom?.trim() || !prenoms?.trim()) {
      return res.status(400).json({ message: 'Nom et prénom requis.' });
    }
    if (!matriculeBody?.trim()) {
      return res.status(400).json({ message: 'Matricule requis.' });
    }
    if (!email?.trim()) {
      return res.status(400).json({ message: 'Email requis.' });
    }
    if (!motDePasse || motDePasse.length < 4) {
      return res.status(400).json({ message: 'Mot de passe requis (4 caractères minimum).' });
    }
    if (!filiere?.trim()) {
      return res.status(400).json({ message: 'Filière requise.' });
    }
    if (!niveau?.trim()) {
      return res.status(400).json({ message: 'Niveau requis.' });
    }

    const etabReg = await resolveEtablissement(req);
    if (etabReg.invalide) return res.status(404).json({ message: 'Établissement introuvable.' });
    // Le code d'établissement est obligatoire : plus de rattachement par défaut.
    const etabIdReg = etabReg.id;
    if (!etabIdReg) return res.status(400).json(ETAB_REQUIS);

    const er = await pool.query(
      'SELECT modele_matricule, inscription_ouverte, inscription_validation FROM etablissements WHERE id = $1',
      [etabIdReg]
    );
    const etab = er.rows[0] || {};
    if (etab.inscription_ouverte !== true) {
      return res.status(403).json({
        message: "L'inscription en ligne est fermée pour cet établissement. Rapprochez-vous de l'administration.",
      });
    }

    const matricule = matriculeBody.trim().toUpperCase();
    const v = validerMatricule(etab.modele_matricule, matricule);
    if (!v.ok) return res.status(400).json({ message: v.message });

    client = await pool.connect();

    // Unicité du matricule (un matricule déjà créé par l'administration = utiliser « Se connecter »).
    const existingUser = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: 'Ce matricule est déjà enregistré. Utilisez « Se connecter » (première connexion) ou contactez l\'administration.',
      });
    }
    const existingEmail = await client.query('SELECT 1 FROM users WHERE email = $1', [email.trim()]);
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    const hashed = await bcrypt.hash(motDePasse, 10);

    const filiereRes = await client.query(
      'SELECT id FROM filieres WHERE nom = $1 AND etablissement_id = $2',
      [filiere.trim(), etabIdReg]
    );
    const filiereId = filiereRes.rows[0]?.id || null;

    const enAttente = etab.inscription_validation !== false;
    const statut = enAttente ? 'en_attente' : 'actif';

    const userRes = await client.query(
      `INSERT INTO users (matricule, nom, prenoms, email, tel, role, statut, mot_de_passe, etablissement_id, filiere_nom, niveau, nom_parent, tel_parent)
       VALUES ($1, $2, $3, $4, $5, 'etudiant', $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [matricule, nom.trim().toUpperCase(), prenoms.trim(), email.trim(), telephone?.trim() || null, statut, hashed,
        etabIdReg, filiere.trim(), niveau.trim(), nomPersonne?.trim() || null, telPersonne?.trim() || null]
    );
    const user = userRes.rows[0];

    await client.query(
      `INSERT INTO etudiants (user_id, filiere_id, premierefois, matricule, nom, prenoms, email, tel, filiere_nom, niveau, statut, etablissement_id, nom_parent, tel_parent)
       VALUES ($1, $2, false, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [user.id, filiereId, matricule, nom.trim().toUpperCase(), prenoms.trim(), email.trim(), telephone?.trim() || null,
        filiere.trim(), niveau.trim(), statut, etabIdReg, nomPersonne?.trim() || null, telPersonne?.trim() || null]
    );

    if (enAttente) {
      return res.status(201).json({
        pending: true,
        message: "Votre demande est enregistrée. Vous pourrez vous connecter dès qu'elle sera validée par l'administration.",
      });
    }

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
    console.error('Register error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Matricule ou email déjà utilisé.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    if (client) client.release();
  }
};

// Limiteur en mémoire pour « mot de passe oublié » / réinitialisation :
// empêche de deviner le code à 6 chiffres par essais répétés.
const _essaisMdp = new Map();
function tropEssaisMdp(cle, max, fenetreMs) {
  const now = Date.now();
  const e = _essaisMdp.get(cle);
  if (!e || now - e.debut > fenetreMs) {
    _essaisMdp.set(cle, { n: 1, debut: now });
    return false;
  }
  e.n += 1;
  return e.n > max;
}

// ── Mot de passe oublié ───────────────────────────────────────────────────────
// Code à 6 chiffres tiré avec crypto (imprévisible), stocké HACHÉ (HMAC) dans
// users.reset_code_hash, valable 15 min, invalidé après 5 essais ratés.
const MAX_ESSAIS_CODE = 5;
const hacherCode = (userId, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || 'scolarhub').update(`${userId}:${String(code).trim()}`).digest('hex');
const memeHash = (a, b) => {
  const x = Buffer.from(String(a || ''), 'hex'); const y = Buffer.from(String(b || ''), 'hex');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
// « ibrahim@gmail.com » -> « i***@gmail.com »
const masquerEmail = (e) => {
  const [loc, dom] = String(e || '').split('@');
  if (!loc || !dom) return '';
  return `${loc[0]}***@${dom}`;
};
const MSG_CODE_ENVOYE = 'Si un compte correspond, un code de réinitialisation vient d\'être envoyé par email. '
  + 'Sans email reçu, contactez l\'administration de votre établissement.';

const forgotPassword = async (req, res) => {
  try {
    const { identifiant } = req.body;
    if (!identifiant) return res.status(400).json({ message: 'Matricule ou email requis.' });

    const etab = await resolveEtablissement(req);
    if (etab.invalide) return res.status(404).json({ message: 'Établissement introuvable.' });
    if (!etab.id) return res.status(400).json(ETAB_REQUIS);

    if (tropEssaisMdp(`fp:${req.ip}:${String(identifiant).trim().toLowerCase()}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ message: 'Trop de demandes. Réessayez dans une heure.' });
    }

    // Chercher l'utilisateur par matricule ou email, dans l'établissement
    const paramsFp = [identifiant.trim()];
    const r = await pool.query(
      `SELECT id, email, nom FROM users WHERE (UPPER(matricule) = UPPER($1) OR LOWER(email) = LOWER($1))${etabClause(paramsFp, etab.id, 'users')}`,
      paramsFp
    );
    const user = r.rows[0];
    const emailReel = user && user.email && !/@sans-email\.scolarhub$/i.test(user.email) ? user.email : null;

    // Même réponse que le compte existe ou non (pas de devinette des comptes).
    const reponse = { message: MSG_CODE_ENVOYE, email: emailReel ? masquerEmail(emailReel) : '' };
    if (!emailReel) return res.status(200).json(reponse);

    const resetCode = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 15 * 60000); // 15 minutes
    await pool.query(
      'UPDATE users SET reset_code = NULL, reset_code_hash = $1, reset_expires = $2, reset_essais = 0 WHERE id = $3',
      [hacherCode(user.id, resetCode), expiresAt, user.id]
    );

    const emailResult = await emailService.envoyer(
      emailReel,
      'ScolarHub - Réinitialisation de mot de passe',
      {
        etablissementId: etab.id,
        text: `Bonjour ${user.nom},\n\nVotre code de réinitialisation est : ${resetCode}\n\nCe code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nL'équipe ScolarHub`,
      }
    );
    if (!emailResult.success) console.error('[forgotPassword] envoi email échoué :', emailResult.error);

    // Le code n'est renvoyé au client QUE si les e-mails sont en mode « console »
    // (développement). En production il n'est jamais exposé.
    return res.status(200).json({ ...reponse, code: process.env.EMAIL_PROVIDER === 'console' ? resetCode : undefined });
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

    const etab = await resolveEtablissement(req);
    if (etab.invalide) return res.status(404).json({ message: 'Établissement introuvable.' });
    if (!etab.id) return res.status(400).json(ETAB_REQUIS);

    if (tropEssaisMdp(`rp:${req.ip}:${String(identifiant).trim().toLowerCase()}`, 8, 15 * 60 * 1000)) {
      return res.status(429).json({ message: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }

    const paramsRp = [identifiant.trim()];
    const r = await pool.query(
      `SELECT id, reset_code_hash, reset_expires, reset_essais FROM users WHERE (UPPER(matricule) = UPPER($1) OR LOWER(email) = LOWER($1))${etabClause(paramsRp, etab.id, 'users')}`,
      paramsRp
    );
    const user = r.rows[0];
    const MSG_CODE_KO = 'Code incorrect ou expiré. Refaites une demande si besoin.';

    // Compte inconnu, pas de code en cours ou code expiré : même réponse.
    if (!user || !user.reset_code_hash || !user.reset_expires || new Date() > new Date(user.reset_expires)) {
      return res.status(400).json({ message: MSG_CODE_KO });
    }
    if ((user.reset_essais || 0) >= MAX_ESSAIS_CODE) {
      await pool.query('UPDATE users SET reset_code_hash = NULL, reset_expires = NULL, reset_essais = 0 WHERE id = $1', [user.id]);
      return res.status(400).json({ message: 'Trop d\'essais : ce code est annulé. Refaites une demande.' });
    }
    if (!memeHash(user.reset_code_hash, hacherCode(user.id, code))) {
      const essais = (user.reset_essais || 0) + 1;
      if (essais >= MAX_ESSAIS_CODE) {
        await pool.query('UPDATE users SET reset_code_hash = NULL, reset_expires = NULL, reset_essais = 0 WHERE id = $1', [user.id]);
        return res.status(400).json({ message: 'Trop d\'essais : ce code est annulé. Refaites une demande.' });
      }
      await pool.query('UPDATE users SET reset_essais = $1 WHERE id = $2', [essais, user.id]);
      return res.status(400).json({ message: MSG_CODE_KO });
    }

    if (String(newPassword).length < 4) {
      return res.status(400).json({ message: 'Mot de passe : minimum 4 caractères.' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET mot_de_passe = $1, reset_code = NULL, reset_code_hash = NULL, reset_expires = NULL, reset_essais = 0 WHERE id = $2',
      [hashed, user.id]
    );

    return res.status(200).json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('ResetPassword error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/auth/etablissement?code=IST2026  (public)
// Renvoie ce qu'il faut afficher avant la connexion : nom, logo, type et
// modèle de matricule (contrôle facultatif côté saisie). Rien de sensible.
const etablissementParCode = async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ found: false, message: "Code d'établissement requis." });
    const r = await pool.query(
      `SELECT id, nom, sigle, ville, campus, type, logo_url, photo_accueil_url, modele_matricule, inscription_ouverte
       FROM etablissements WHERE UPPER(code) = UPPER($1) AND COALESCE(actif, true) = true`,
      [code]
    );
    const e = r.rows[0];
    if (!e) return res.status(404).json({ found: false, message: 'Code établissement inconnu.' });
    return res.status(200).json({ found: true, etablissement: e });
  } catch (err) {
    console.error('etablissementParCode error:', err);
    return res.status(500).json({ found: false, message: 'Erreur serveur.' });
  }
};

// GET /api/auth/filieres?code_etablissement=IST2026  (public)
// Liste des filières (noms seulement) pour l'écran d'inscription, qui s'ouvre
// avant toute connexion. Uniquement si l'inscription est ouverte.
const filieresPubliques = async (req, res) => {
  try {
    const etab = await resolveEtablissement(req);
    if (etab.invalide || !etab.id) return res.status(404).json({ message: 'Établissement introuvable.' });
    const er = await pool.query('SELECT inscription_ouverte FROM etablissements WHERE id = $1', [etab.id]);
    if (er.rows[0]?.inscription_ouverte !== true) {
      return res.status(403).json({ message: "L'inscription en ligne est fermée pour cet établissement." });
    }
    let rows;
    try {
      rows = (await pool.query('SELECT id, nom FROM filieres WHERE etablissement_id = $1 ORDER BY nom', [etab.id])).rows;
    } catch (e) {
      if (e.code !== '42703' && !/etablissement_id/.test(e.message || '')) throw e;
      rows = (await pool.query('SELECT id, nom FROM filieres ORDER BY nom')).rows; // colonne absente
    }
    return res.status(200).json(rows);
  } catch (err) {
    console.error('filieresPubliques error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  filieresPubliques,
  etablissementParCode,
  login,
  setupPassword,
  me,
  modifierProfil,
  changePassword,
  register,
  lookup,
  forgotPassword,
  resetPassword,
};