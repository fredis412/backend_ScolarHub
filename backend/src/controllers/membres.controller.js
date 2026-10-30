const pool = require('../config/db');
const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
const { messageConflitUnique } = require('../utils/erreursSql');

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
// Un administrateur appartient à un établissement (users / administrateurs / membres).
const membreDeMonEtab = async (id, etabId) => {
  if (!etabId) return true;
  const r = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND etablissement_id = $2`, [id, etabId]
  );
  return r.rows.length > 0;
};

// ── Garde-fous Super Admin ───────────────────────────────────────────────────
// Le compte visé est-il un Super Admin ? Et est-ce le DERNIER actif de son école ?
const infoSuperAdmin = async (id) => {
  const r = await pool.query(
    `SELECT admin_sub_role, statut, etablissement_id FROM users WHERE id = $1`, [id]
  );
  const u = r.rows[0];
  if (!u || u.admin_sub_role !== 'super_admin') return { superAdmin: false, dernier: false };
  if (u.statut !== 'actif') return { superAdmin: true, dernier: false };
  const c = await pool.query(
    `SELECT COUNT(*)::int AS c FROM users
     WHERE role = 'admin' AND admin_sub_role = 'super_admin' AND statut = 'actif'
       AND etablissement_id IS NOT DISTINCT FROM $1 AND id <> $2`,
    [u.etablissement_id, id]
  );
  return { superAdmin: true, dernier: c.rows[0].c === 0 };
};
const MSG_DERNIER = "C'est le dernier Super Admin actif de l'établissement : nommez d'abord un autre Super Admin.";

// ── Autorisations de l'administrateur connecté ───────────────────────────────
const lireAutorisations = async (userId) => {
  const r = await pool.query(
    `SELECT u.admin_sub_role, COALESCE(m.permissions, '{}'::jsonb) AS permissions
     FROM users u LEFT JOIN membres m ON m.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  let perms = row.permissions || {};
  if (typeof perms === 'string') { try { perms = JSON.parse(perms); } catch (_) { perms = {}; } }
  return { role: row.admin_sub_role || 'super_admin', permissions: perms };
};

// Middleware : seul un Super Admin — ou un membre dont l'autorisation « membres »
// (Créer des membres) est activée — peut lister / créer / modifier / supprimer des
// membres. Évite qu'un Resp. Scolarité s'octroie des droits en appelant l'API.
const exigerGestionMembres = async (req, res, next) => {
  try {
    const a = await lireAutorisations(req.user.id);
    if (!a) return res.status(403).json({ success: false, message: 'Accès refusé.' });
    req.estSuperAdmin = a.role === 'super_admin';
    if (req.estSuperAdmin || a.permissions.membres === true) return next();
    return res.status(403).json({ success: false, message: "Vous n'avez pas l'autorisation de gérer les membres." });
  } catch (err) {
    console.error('exigerGestionMembres error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/membres/moi — Droits de l'administrateur connecté (pour le menu) ──
const getMesPermissions = async (req, res) => {
  try {
    const a = await lireAutorisations(req.user.id);
    if (!a) return res.status(404).json({ success: false, message: 'Compte introuvable.' });
    const droits = {};
    Object.entries(a.permissions).forEach(([k, v]) => { if (typeof v === 'boolean') droits[k] = v; });
    return res.status(200).json({ success: true, data: { role: a.role, droits } });
  } catch (err) {
    console.error('getMesPermissions error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/membres — Récupérer tous les administrateurs et membres ────────
const getAllMembres = async (req, res) => {
  try {
    let membres = [];
    try {
      const pl = [];
      let filtreEtab = '';
      if (req.etablissementId) {
        pl.push(req.etablissementId);
        filtreEtab = ` AND u.etablissement_id = $${pl.length}`;
      }
      const r = await pool.query(
        `SELECT u.id, u.nom, u.prenoms, u.email, u.tel, u.role, u.admin_sub_role, u.statut,
                COALESCE(m.permissions, '{}'::jsonb) AS permissions
         FROM users u
         LEFT JOIN membres m ON u.id = m.user_id
         WHERE (u.role = 'admin' OR u.role = 'admi' OR u.role = 'administrator')${filtreEtab}
         ORDER BY u.nom`,
        pl
      );
      membres = r.rows;
    } catch (dbErr) {
      console.warn('Direct PG failed in getAllMembres, fallback to Supabase SDK:', dbErr.message);
      if (supabase && typeof supabase.from === 'function') {
        let q = supabase
          .from('users')
          .select('id, nom, prenoms, email, tel, role, admin_sub_role, statut, permissions')
          .or('role.eq.admin,role.eq.admi');
        if (req.etablissementId) q = q.eq('etablissement_id', req.etablissementId);
        const { data, error } = await q;
        if (!error && data) membres = data;
      }
    }

    return res.status(200).json({
      success: true,
      data: membres.map((m) => {
        const permissionsParsed = typeof m.permissions === 'string' ? JSON.parse(m.permissions) : (m.permissions || {});
        return {
          id: m.id,
          nom: m.nom || '',
          prenoms: m.prenoms || '',
          email: m.email || '',
          tel: m.tel || '',
          numero: m.tel || '',
          role: m.admin_sub_role || m.role || 'super_admin',
          admin_sub_role: m.admin_sub_role || 'super_admin',
          domaine: m.domaine || permissionsParsed.domaine || 'Tous',
          droits: permissionsParsed,
          actif: m.statut !== 'suspendu' && m.statut !== 'renvoye',
          dateCreation: m.created_at ? new Date(m.created_at).toLocaleDateString('fr-FR') : '01/01/2026',
        };
      }),
    });
  } catch (err) {
    console.error('getAllMembres error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération.' });
  }
};

// ── POST /api/membres — Inscrire un nouvel administrateur en Base de Données ──
const createMembre = async (req, res) => {
  let client;
  try {
    const { nom, prenoms, email, tel, telephone, numero, motDePasse, role, admin_sub_role, domaine, permissions } = req.body;

    const telFinal = (tel || telephone || numero || '').toString().trim() || null;
    if (!nom || !prenoms || !email || !telFinal) {
      return res.status(400).json({ success: false, message: 'Nom, prénoms, email et téléphone sont requis.' });
    }

    // Plus de mot de passe à la création : le membre se connecte avec son nom, son
    // prénom et son téléphone, puis définit son mot de passe à la première connexion
    // (comme les professeurs). Un mot de passe fourni (anciens clients) reste accepté.
    const hashedPassword = motDePasse ? await bcrypt.hash(String(motDePasse), 10) : null;
    if ((admin_sub_role || role) === 'super_admin' && !req.estSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Seul un Super Admin peut créer un Super Admin.' });
    }
    const subRole = admin_sub_role || role || 'scolarite';
    const domaineFinal = domaine || 'Tous';
    const permissionsObj = { ...(permissions || {}), domaine: domaineFinal };

    const etabId = req.etablissementId || null;
    let createdUser = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      // Vérifier si l'email existe déjà
      const checkEmail = await client.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
      if (checkEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé par un autre compte.' });
      }

      // Générer matricule admin unique (la clé users.matricule est globale : on
      // incrémente jusqu'à trouver un numéro libre, quel que soit l'établissement)
      const pc = [];
      let filtreCount = '';
      if (etabId) { pc.push(etabId); filtreCount = ` AND etablissement_id = $${pc.length}`; }
      const countRes = await client.query(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin'${filtreCount}`, pc);
      let numAdm = countRes.rows[0].c + 1;
      let matricule;
      for (let i = 0; i < 200; i += 1, numAdm += 1) {
        matricule = `ADM-${new Date().getFullYear()}-${numAdm.toString().padStart(3, '0')}`;
        const dejaPris = await client.query('SELECT 1 FROM users WHERE matricule = $1', [matricule]);
        if (dejaPris.rows.length === 0) break;
      }

      // 1. Insertion dans la table users
      const userRes = etabId
        ? await client.query(
            `INSERT INTO users (matricule, nom, prenoms, email, tel, mot_de_passe, role, admin_sub_role, statut, etablissement_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7, 'actif', $8)
             RETURNING id, matricule, nom, prenoms, email, tel, role, admin_sub_role`,
            [matricule, nom.trim().toUpperCase(), prenoms.trim(), email.trim().toLowerCase(), telFinal, hashedPassword, subRole, etabId]
          )
        : await client.query(
            `INSERT INTO users (matricule, nom, prenoms, email, tel, mot_de_passe, role, admin_sub_role, statut)
             VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7, 'actif')
             RETURNING id, matricule, nom, prenoms, email, tel, role, admin_sub_role`,
            [matricule, nom.trim().toUpperCase(), prenoms.trim(), email.trim().toLowerCase(), telFinal, hashedPassword, subRole]
          );
      createdUser = userRes.rows[0];

      // 2. Insertion dans la table membres / permissions
      await client.query(
        `INSERT INTO membres (user_id, permissions)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions`,
        [createdUser.id, JSON.stringify(permissionsObj)]
      );
      if (etabId) {
        // etablissement_id existe sur membres / administrateurs (migration phase 1)
        try { await client.query('UPDATE membres SET etablissement_id = $1 WHERE user_id = $2', [etabId, createdUser.id]); } catch (_) {}
      }

      // 3. Insertion dans la table administrateurs (sans colonne 'role' qui n'existe pas)
      try {
        await client.query(
          `INSERT INTO administrateurs (user_id, nom, prenoms, email, tel, admin_sub_role, permissions, statut)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'actif')
           ON CONFLICT (user_id) DO UPDATE SET
             nom = EXCLUDED.nom, prenoms = EXCLUDED.prenoms,
             email = EXCLUDED.email, tel = EXCLUDED.tel,
             admin_sub_role = EXCLUDED.admin_sub_role,
             permissions = EXCLUDED.permissions`,
          [createdUser.id, nom.trim().toUpperCase(), prenoms?.trim() || '', email.trim().toLowerCase(), telFinal, subRole, JSON.stringify(permissionsObj)]
        );
        if (etabId) {
          try { await client.query('UPDATE administrateurs SET etablissement_id = $1 WHERE user_id = $2', [etabId, createdUser.id]); } catch (_) {}
        }
      } catch (admErr) {
        console.warn('[createMembre] Insertion dans administrateurs échouée:', admErr.message);
      }

      await client.query('COMMIT');
    } catch (dbErr) {
      if (client) try { await client.query('ROLLBACK'); } catch (_) { }
      console.warn('Direct PG failed in createMembre, fallback to Supabase SDK:', dbErr.message);

      if (supabase && typeof supabase.from === 'function') {
        const { data: userSup, error: errSup } = await supabase.from('users').insert([{
          nom: nom.trim().toUpperCase(),
          prenoms: prenoms?.trim() || '',
          email: email.trim().toLowerCase(),
          tel: telFinal,
          mot_de_passe: hashedPassword,
          role: 'admin',
          admin_sub_role: subRole,
          statut: 'actif',
          ...(etabId ? { etablissement_id: etabId } : {}),
        }]).select().single();

        if (errSup) {
          console.error('[createMembre] Supabase insert error:', errSup.message);
          const doublon = messageConflitUnique(errSup);
          if (doublon) return res.status(409).json({ success: false, message: doublon });
          return res.status(500).json({ success: false, message: 'Erreur serveur lors de la création.' });
        }
        createdUser = userSup;

        // Insertion dans membres
        await supabase.from('membres').insert([{
          user_id: createdUser.id,
          permissions: permissionsObj
        }]);

        // Insertion dans administrateurs via Supabase SDK (sans colonne 'role')
        const { error: admSupErr } = await supabase.from('administrateurs').upsert([{
          user_id: createdUser.id,
          nom: nom.trim().toUpperCase(),
          prenoms: prenoms?.trim() || '',
          email: email.trim().toLowerCase(),
          tel: telFinal,
          admin_sub_role: subRole,
          permissions: permissionsObj,
          statut: 'actif',
          ...(etabId ? { etablissement_id: etabId } : {}),
        }], { onConflict: 'user_id' });

        if (admSupErr) {
          console.warn('[createMembre] Supabase administrateurs upsert error:', admSupErr.message);
        }
      }
    } finally {
      if (client) client.release();
    }

    // Domaine d'attribution (colonne utilisée à la connexion) — hors transaction, non bloquant.
    try {
      await pool.query('UPDATE administrateurs SET domaine_admin = $1 WHERE user_id = $2', [domaineFinal, createdUser.id]);
    } catch (_) { /* colonne absente : le domaine reste lu depuis permissions.domaine */ }

    return res.status(201).json({
      success: true,
      message: 'Administrateur créé avec succès en base de données.',
      data: {
        id: createdUser.id,
        nom: createdUser.nom,
        prenoms: createdUser.prenoms,
        email: createdUser.email,
        role: createdUser.admin_sub_role || subRole,
        admin_sub_role: subRole,
        domaine: domaineFinal,
        droits: permissionsObj,
        actif: true,
      },
    });
  } catch (err) {
    console.error('createMembre error:', err);
    const doublon = messageConflitUnique(err);
    if (doublon) return res.status(409).json({ success: false, message: doublon });
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la création.' });
  }
};

// ── PATCH /api/membres/:id/permissions — Modifier les droits ─────────────────
const updatePermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions, role } = req.body;

    if (role === 'super_admin' && !req.estSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Seul un Super Admin peut attribuer ce rôle.' });
    }
    if (!(await membreDeMonEtab(id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Membre introuvable.' });
    }
    if (role && role !== 'super_admin') {
      const info = await infoSuperAdmin(id);
      if (info.superAdmin && !req.estSuperAdmin) {
        return res.status(403).json({ success: false, message: 'Seul un Super Admin peut modifier un Super Admin.' });
      }
      if (info.dernier) return res.status(409).json({ success: false, message: MSG_DERNIER });
    }

    try {
      await pool.query(
        `INSERT INTO membres (user_id, permissions)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET permissions = $2`,
        [id, JSON.stringify(permissions || {})]
      );

      if (role) {
        await pool.query('UPDATE users SET admin_sub_role = $1 WHERE id = $2', [role, id]);
      }
    } catch (dbErr) {
      if (supabase && typeof supabase.from === 'function') {
        await supabase.from('membres').upsert({ user_id: id, permissions: permissions || {} });
        if (role) await supabase.from('users').update({ admin_sub_role: role }).eq('id', id);
      }
    }

    return res.status(200).json({ success: true, message: 'Permissions mises à jour en base de données.' });
  } catch (err) {
    console.error('updatePermissions error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ── PUT /api/membres/:id — Modifier les informations, le sous-rôle, le domaine ──
// et les autorisations d'un membre (panneau « Modifier le membre »).
const updateMembre = async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, prenoms, email, tel, telephone, numero, role, admin_sub_role, domaine, permissions } = req.body;

    if (!(await membreDeMonEtab(id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Membre introuvable.' });
    }

    const emailFinal = email ? String(email).trim().toLowerCase() : undefined;
    if (emailFinal) {
      const dup = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2', [emailFinal, id]);
      if (dup.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé par un autre compte.' });
      }
    }

    const subRole = admin_sub_role || role || undefined;
    if (subRole === 'super_admin' && !req.estSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Seul un Super Admin peut attribuer ce rôle.' });
    }
    if (subRole && subRole !== 'super_admin') {
      const info = await infoSuperAdmin(id);
      if (info.superAdmin && !req.estSuperAdmin) {
        return res.status(403).json({ success: false, message: 'Seul un Super Admin peut modifier un Super Admin.' });
      }
      if (info.dernier) return res.status(409).json({ success: false, message: MSG_DERNIER });
    }
    const telBrut = tel ?? telephone ?? numero;
    const telFinal = telBrut === undefined || telBrut === null ? undefined : String(telBrut).trim();
    const nomFinal = nom ? String(nom).trim().toUpperCase() : undefined;
    const prenomsFinal = prenoms ? String(prenoms).trim() : undefined;

    // 1. users
    const sets = []; const p = [];
    const add = (col, val) => { if (val === undefined || val === null || val === '') return; p.push(val); sets.push(`${col} = $${p.length}`); };
    add('nom', nomFinal); add('prenoms', prenomsFinal); add('email', emailFinal);
    add('tel', telFinal); add('admin_sub_role', subRole);
    if (sets.length) {
      p.push(id);
      await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${p.length}`, p);
    }

    // 2. membres.permissions (droits + domaine)
    let permsFinal = null;
    if (permissions !== undefined || domaine !== undefined) {
      const cur = await pool.query('SELECT permissions FROM membres WHERE user_id = $1', [id]);
      let actuel = cur.rows[0]?.permissions || {};
      if (typeof actuel === 'string') { try { actuel = JSON.parse(actuel); } catch (_) { actuel = {}; } }
      permsFinal = { ...(permissions !== undefined ? permissions : actuel) };
      permsFinal.domaine = domaine || actuel.domaine || 'Tous';
      await pool.query(
        `INSERT INTO membres (user_id, permissions) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions`,
        [id, JSON.stringify(permsFinal)]
      );
    }

    // 3. administrateurs (miroir, non bloquant)
    try {
      await pool.query(
        `UPDATE administrateurs SET nom = COALESCE($1, nom), prenoms = COALESCE($2, prenoms),
                email = COALESCE($3, email), tel = COALESCE($4, tel),
                admin_sub_role = COALESCE($5, admin_sub_role)
         WHERE user_id = $6`,
        [nomFinal ?? null, prenomsFinal ?? null, emailFinal ?? null, telFinal ?? null, subRole ?? null, id]
      );
      if (permsFinal) {
        await pool.query('UPDATE administrateurs SET permissions = $1, domaine_admin = $2 WHERE user_id = $3',
          [JSON.stringify(permsFinal), permsFinal.domaine, id]);
      }
    } catch (admErr) {
      console.warn('[updateMembre] miroir administrateurs:', admErr.message);
    }

    return res.status(200).json({ success: true, message: 'Membre mis à jour.' });
  } catch (err) {
    console.error('updateMembre error:', err);
    const doublon = messageConflitUnique(err);
    if (doublon) return res.status(409).json({ success: false, message: doublon });
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la modification.' });
  }
};

// ── PATCH /api/membres/:id/statut — Suspendre / réactiver un membre ──────────
const changerStatutMembre = async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;
    if (!['actif', 'suspendu'].includes(statut)) {
      return res.status(400).json({ success: false, message: "Statut invalide (actif ou suspendu)." });
    }
    if (req.user && String(req.user.id) === String(id)) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas modifier votre propre statut.' });
    }
    if (!(await membreDeMonEtab(id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Membre introuvable.' });
    }
    const info = await infoSuperAdmin(id);
    if (info.superAdmin && !req.estSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Seul un Super Admin peut modifier un Super Admin.' });
    }
    if (statut === 'suspendu' && info.dernier) return res.status(409).json({ success: false, message: MSG_DERNIER });
    await pool.query('UPDATE users SET statut = $1 WHERE id = $2', [statut, id]);
    try { await pool.query('UPDATE administrateurs SET statut = $1 WHERE user_id = $2', [statut, id]); } catch (_) {}
    return res.status(200).json({ success: true, message: statut === 'actif' ? 'Membre réactivé.' : 'Membre suspendu.' });
  } catch (err) {
    console.error('changerStatutMembre error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ── DELETE /api/membres/:id — Supprimer un administrateur ────────────────────
const deleteMembre = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user && String(req.user.id) === String(id)) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }
    if (!(await membreDeMonEtab(id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Membre introuvable.' });
    }
    const info = await infoSuperAdmin(id);
    if (info.superAdmin && !req.estSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Seul un Super Admin peut supprimer un Super Admin.' });
    }
    if (info.dernier) return res.status(409).json({ success: false, message: MSG_DERNIER });
    try {
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    } catch (dbErr) {
      if (supabase && typeof supabase.from === 'function') {
        await supabase.from('users').delete().eq('id', id);
      }
    }
    return res.status(200).json({ success: true, message: 'Membre supprimé de la base de données.' });
  } catch (err) {
    console.error('deleteMembre error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression.' });
  }
};

// ── POST /api/membres/:id/reinitialiser-mdp — Mot de passe oublié ────────────
// Efface le mot de passe du membre : à sa prochaine connexion (nom, prénom, téléphone),
// il en choisit un nouveau, exactement comme à sa première connexion. Personne, pas même
// le Super Admin, ne voit ni ne connaît le nouveau mot de passe.
const reinitialiserMotDePasse = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user && String(req.user.id) === String(id)) {
      return res.status(400).json({ success: false, message: 'Pour votre propre compte, utilisez « Changer mon mot de passe ».' });
    }
    if (!(await membreDeMonEtab(id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Membre introuvable.' });
    }
    const info = await infoSuperAdmin(id);
    if (info.superAdmin && !req.estSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Seul un Super Admin peut réinitialiser un Super Admin.' });
    }
    const u = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'admin'", [id]);
    if (!u.rows.length) return res.status(404).json({ success: false, message: 'Membre introuvable.' });
    await pool.query('UPDATE users SET mot_de_passe = NULL WHERE id = $1', [id]);
    try { await pool.query('UPDATE users SET mdp_a_changer = false WHERE id = $1', [id]); } catch (_) {}
    return res.status(200).json({
      success: true,
      message: 'Mot de passe réinitialisé. Le membre choisira un nouveau mot de passe à sa prochaine connexion.',
    });
  } catch (err) {
    console.error('reinitialiserMotDePasse error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = {
  reinitialiserMotDePasse,
  getAllMembres,
  createMembre,
  exigerGestionMembres,
  getMesPermissions,
  updatePermissions,
  updateMembre,
  changerStatutMembre,
  deleteMembre,
};