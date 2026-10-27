// ============================================================
// src/controllers/messageController.js
// ZOUNGRANA Jalil — Contrôleur REST Messagerie
// ============================================================

const pool = require('../config/db');
const supabase = require('../config/supabase');
const { notifierUser } = require('../socket/socketHandler');

const { resolveFiliere, normalizeNiveau } = require('../utils/filieres');
const { ensureCanauxStandard } = require('../utils/canauxStandard');

// Types de canaux « publics » : lisibles par tout utilisateur authentifié,
// sans inscription préalable dans canal_membres (les droits d'écriture
// restent gérés par rôle côté app / canal_membres).
const STANDARD_CANAUX = {
  1: { nom: 'Administration', type: 'administration', description: 'Annonces officielles de l\'administration' },
  2: { nom: 'Admin & Filière', type: 'admin_filiere', description: 'Échanges entre l\'administration et les délégués de filière' },
  3: { nom: 'Bureau des Étudiants', type: 'bde', description: 'Annonces et activités du BDE' },
  4: { nom: 'Salle des Professeurs', type: 'professeurs', description: 'Canal d\'échanges entre professeurs' },
  5: { nom: 'Administration & Professeurs', type: 'admin_profs', description: 'Canal officiel Admin ↔ Tous les professeurs' },
  6: { nom: 'Administration & Délégués', type: 'admin_delegues', description: 'Canal officiel Admin ↔ Délégués de filières' },
};

// ✅ Types dont l'accès est réservé strictement aux membres explicites
// (canal_membres) — la règle générale "tout admin/prof a accès à tout" ne
// s'applique PAS à ces types. Ce sont des canaux à audience restreinte :
// un sous-fil "Professeurs & Délégués" (prof_delegue_niveau) ne doit être
// visible que par le prof concerné + le(s) délégué(s)/adjoint(s) de ce
// niveau précis — ni les autres profs, ni l'administration, ni les autres
// étudiants.
const TYPES_ACCES_RESTREINT = ['prof_delegue_niveau'];

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; absent (anciens jetons) = pas de filtre.
// Un canal appartient à un établissement (canaux.etablissement_id) ; les
// messages suivent leur canal ; les groupes filière suivent filieres.etablissement_id.
async function filiereDeMonEtab(filiereId, etabId) {
  if (!etabId) return true;
  if (filiereId === undefined || filiereId === null || filiereId === '') return false;
  const r = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [filiereId, etabId]);
  return r.rows.length > 0;
}
async function userDeMonEtab(userId, etabId) {
  if (!etabId) return true;
  const r = await pool.query('SELECT 1 FROM users WHERE id = $1 AND etablissement_id = $2', [userId, etabId]);
  return r.rows.length > 0;
}
// Ajoute « AND <alias>.etablissement_id = $N » seulement si l'établissement est connu.
function etabSql(params, etabId, alias) {
  if (!etabId) return '';
  params.push(etabId);
  return ` AND ${alias}.etablissement_id = $${params.length}`;
}

// GET /api/messages/canaux-standard — ids des canaux standard (administration, bde,
// professeurs, admin_profs, admin_filiere, admin_delegues) de MON établissement.
// L'app s'en sert au lieu des anciens numéros fixes 1 à 6.
const getCanauxStandard = async (req, res) => {
  try {
    const data = await ensureCanauxStandard(req.etablissementId || null);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[getCanauxStandard]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

async function ensureCanalExists(canalId, etabId) {
  const numId = parseInt(canalId, 10);
  if (!numId) return null;
  const { rows: existing } = await pool.query('SELECT id, type, nom, professeur_id, filiere_id, niveau, etablissement_id FROM canaux WHERE id = $1', [numId]);
  if (existing.length) return existing[0];

  // Si c'est un canal standard manquant, le créer automatiquement dans la base
  if (STANDARD_CANAUX[numId]) {
    const std = STANDARD_CANAUX[numId];
    try {
      const { rows } = await pool.query(
        `INSERT INTO canaux (id, nom, description, type, etablissement_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type
         RETURNING id, type, nom, professeur_id, filiere_id, niveau, etablissement_id`,
        [numId, std.nom, std.description, std.type, etabId || null]
      );
      return rows[0];
    } catch (e) {
      console.error('[ensureCanalExists] Erreur création canal standard:', e.message);
    }
  }
  return null;
}

// Vérifie l'accès EN LECTURE d'un utilisateur à un canal : membre, canal
// public, ou règle spécifique au type. Accepte aussi les professeurs sur
// les canaux prof/admin par rôle JWT — SAUF pour les types à audience
// restreinte ou gérée différemment (TYPES_ACCES_RESTREINT, et
// admin_filiere_niveau qui a sa propre règle ci-dessous).
async function accesCanal(canalId, userId, userRole, etabId) {
  const normRole = String(userRole || '').toLowerCase().trim();

  // 0. Résoudre le canal d'abord, pour connaître son type et sa règle d'accès.
  const canal = await ensureCanalExists(canalId, etabId);
  // Étanchéité : un canal d'un autre établissement n'est jamais accessible
  // (même pour un admin ou un professeur).
  if (etabId && canal && canal.etablissement_id && String(canal.etablissement_id) !== String(etabId)) {
    return false;
  }
  const numId = parseInt(canalId, 10);
  const type = canal ? canal.type : (STANDARD_CANAUX[numId] ? STANDARD_CANAUX[numId].type : null);

  // Cas "Admin Filière" par niveau : lecture ouverte à l'admin et à tout
  // étudiant appartenant à CE (filiere_id, niveau) précis — pas aux profs,
  // pas aux étudiants d'un autre niveau/filière. Géré ici en dehors de la
  // logique générique ci-dessous (ni membre explicite requis, ni bypass
  // "tout prof/admin" générique).
  if (type === 'admin_filiere_niveau' && canal) {
    if (normRole === 'admin') return true;
    const { rows } = await pool.query(
      `SELECT 1 FROM etudiants WHERE user_id = $1 AND filiere_id = $2 AND niveau = $3`,
      [userId, canal.filiere_id, canal.niveau]
    );
    return rows.length > 0;
  }

  const accesRestreint = type && TYPES_ACCES_RESTREINT.includes(type);

  // 1. Admin ou Professeur : accès automatique à tous les canaux de
  //    communication — sauf les types à accès restreint (sous-fils prof↔délégués).
  if (!accesRestreint && ['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(normRole)) {
    return true;
  }

  // 2. Vérifier si membre explicite du canal (seule voie d'accès pour les
  //    types à accès restreint).
  const { rows: membre } = await pool.query(
    `SELECT role FROM canal_membres WHERE canal_id = $1 AND user_id = $2`,
    [canalId, userId]
  );
  if (membre.length) return true;

  if (accesRestreint) return false;

  if (!type) return false;

  // Canaux lisibles/éditables par tous
  if (['administration', 'admin_filiere', 'bde', 'general'].includes(type)) return true;

  // Canaux délégués
  if (type === 'admin_delegues') {
    return ['delegue', 'delegue_adjoint'].includes(normRole);
  }

  // Canaux prof_delegues par filière (ancien mécanisme, conservé pour compatibilité)
  if (type.startsWith('prof_delegues:')) return true;

  return false;
}

// Vérifie l'accès EN ÉCRITURE — plus strict que la lecture pour certains
// types. Pour tous les autres types (non listés ici), l'accès en lecture
// (accesCanal) suffit aussi pour écrire — comportement inchangé.
async function peutEcrireCanal(canal, userId, userRole) {
  if (!canal) return true;

  if (canal.type === 'admin_filiere_niveau') {
    const normRole = String(userRole || '').toLowerCase().trim();
    if (normRole === 'admin') return true;
    // Le rôle délégué/adjoint est porté par users.etudiant_role — pas
    // forcément par le rôle générique du JWT ('etudiant').
    const { rows } = await pool.query(
      `SELECT 1 FROM users u JOIN etudiants e ON e.user_id = u.id
       WHERE u.id = $1 AND e.filiere_id = $2 AND e.niveau = $3
         AND LOWER(u.etudiant_role) IN ('delegue', 'delegue_adjoint')`,
      [userId, canal.filiere_id, canal.niveau]
    );
    return rows.length > 0;
  }

  // Canal "Bureau des Étudiants" — lecture seule pour tout le monde, y
  // compris l'administration : le BDE, ce sont des élèves, pas une entité
  // administrative. L'écriture est réservée EXCLUSIVEMENT au président et à
  // l'adjoint BDE (users.etudiant_role), établi à l'échelle de l'école
  // entière (pas de scope filière/niveau, voir getBde/nommerBde dans
  // etudiants.controller.js). Contrairement aux autres types de canaux,
  // aucun bypass admin ici — volontairement.
  if (canal.type === 'bde') {
    const { rows } = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND etudiant_role IN ('bde_president', 'bde_adjoint')`,
      [userId]
    );
    return rows.length > 0;
  }

  return true;
}


// ── GET /api/messages/canaux ──────────────────────────────
// Liste des canaux accessibles par l'utilisateur connecté
const getCanaux = async (req, res) => {
  try {
    const pCan = [req.user.id];
    const etabCan = etabSql(pCan, req.etablissementId, 'c');
    const { rows } = await pool.query(
            `SELECT c.id, c.nom, c.description, c.type, c.professeur_id, c.filiere_id, c.niveau,
              COALESCE(cm.role, 'membre') AS role,
              (SELECT COUNT(*) FROM messages m WHERE m.canal_id = c.id) AS nb_messages
       FROM canaux c
             LEFT JOIN canal_membres cm ON cm.canal_id = c.id AND cm.user_id = $1
             WHERE (cm.user_id IS NOT NULL
                OR c.type IN ('administration', 'admin_filiere', 'bde', 'general', 'professeurs', 'prof_admin', 'admin_profs'))${etabCan}
       ORDER BY c.nom ASC`,
            pCan
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};
// ── GET /api/messages/canal/:id ───────────────────────────
// Historique des messages d'un canal (50 derniers)
const getMessagesCanal = async (req, res) => {
  const { id } = req.params;
  const limite = parseInt(req.query.limite) || 50;
  const avant  = req.query.avant || null; // pour la pagination

  try {
    // Vérifier l'accès (membre, canal public, ou rôle autorisé)
    if (!(await accesCanal(id, req.user.id, req.user.role, req.etablissementId))) {
      return res.status(403).json({ success: false, error: 'Accès refusé à ce canal' });
    }

    // ✅ u.etudiant_role + niveau (via etudiants, fallback users.niveau) ajoutés
    // pour afficher le badge Délégué/Adjoint sur chaque bulle de message.
    // ✅ u.photo_url ajouté — le badge disparaissait de l'écho local (normal,
    // pas de rôle connu avant confirmation serveur) et la PHOTO disparaissait
    // après confirmation car jamais renvoyée par cette requête : le message
    // "officiel" chargé ici remplaçait l'écho local sans jamais porter de photo.
    const { rows: msgs } = await pool.query(
      `SELECT m.id, m.canal_id, m.contenu, m.type, m.created_at,
              u.id AS auteur_id, u.prenoms, u.nom, u.etudiant_role, u.photo_url,
              COALESCE(MAX(e.niveau), u.niveau) AS niveau,
              COALESCE(
                JSON_AGG(r.emoji) FILTER (WHERE r.emoji IS NOT NULL), '[]'
              ) AS reactions,
              EXISTS (SELECT 1 FROM messages_epingles me WHERE me.message_id = m.id AND me.message_type = 'canal') AS epingle
       FROM messages m
       JOIN users u ON u.id = m.auteur_id
       LEFT JOIN etudiants e ON e.user_id = u.id
       LEFT JOIN reactions r ON r.message_id = m.id AND r.message_type = 'canal'
       WHERE m.canal_id = $1 AND COALESCE(m.type, 'canal') != 'annonce'
         AND NOT EXISTS (
           SELECT 1 FROM messages_masques mm
           WHERE mm.message_id = m.id AND mm.message_type = 'canal' AND mm.user_id = $4
         )
         ${avant ? 'AND m.created_at < $3' : ''}
       GROUP BY m.id, u.id
       ORDER BY m.created_at DESC
       LIMIT $2`,
      avant ? [id, limite, avant, req.user.id] : [id, limite, null, req.user.id]
    );

    // Pour le canal 1 (Administration) et 2 (Admin & Filière), inclure également les annonces publiées
    if (id === '1' || id === '2') {
      try {
        const { rows: uInfo } = await pool.query(
          `SELECT u.role, u.filiere_nom, u.niveau,
                  e.filiere_id as e_fid, e.filiere_nom as e_fnom, e.niveau as e_niv
           FROM users u
           LEFT JOIN etudiants e ON e.user_id = u.id
           WHERE u.id = $1`,
          [req.user.id]
        );
        const user = uInfo[0] || req.user;
        const role = (user.role || '').toLowerCase();
        const isStudent = (!role || role === 'etudiant' || role === 'delegue' || role === 'delegue_adjoint');

        // Résoudre l'ID de filière et le niveau
        const rawFiliere = user.e_fid || user.filiere_nom || user.e_fnom;
        const filiereObj = await resolveFiliere(pool, rawFiliere);
        const userFiliereId = filiereObj.id;
        const userNiveauNorm = normalizeNiveau(user.e_niv || user.niveau);

        let annonceQuery = `
          SELECT a.id, a.titre, a.contenu, a.filiere, a.filiere_nom, a.niveau, a."cibleRole",
                 COALESCE(a."createdAt", a."updatedAt", NOW()) AS created_at,
                 u.id AS auteur_id, COALESCE(u.prenoms, 'Administration') AS prenoms, COALESCE(u.nom, 'IST') AS nom
          FROM annonces a
          LEFT JOIN users u ON u.id = a.auteur
          WHERE a.statut = 'publie'
        `;
        const params = [];
        annonceQuery += etabSql(params, req.etablissementId, 'a');

        if (id === '1') {
          // Canal Administration
          if (isStudent) {
            annonceQuery += ` AND (LOWER(COALESCE(a."cibleRole", 'tous')) IN ('tous', 'etudiant'))`;
            
            // Condition filière
            if (userFiliereId) {
              params.push(userFiliereId);
              annonceQuery += ` AND (a.filiere IS NULL OR a.filiere = 0 OR a.filiere = $${params.length})`;
            } else {
              annonceQuery += ` AND (a.filiere IS NULL OR a.filiere = 0)`;
            }

            // Condition niveau
            if (userNiveauNorm) {
              params.push(userNiveauNorm);
              annonceQuery += ` AND (a.niveau IS NULL OR a.niveau = '' OR a.niveau = $${params.length})`;
            }
          }
        } else if (id === '2') {
          // Canal Admin & Filière : uniquement les annonces de sa filière
          if (userFiliereId) {
            params.push(userFiliereId);
            annonceQuery += ` AND a.filiere = $${params.length}`;
          } else if (isStudent) {
            annonceQuery += ` AND 1=0`;
          }
        }

        annonceQuery += ` ORDER BY a."createdAt" DESC LIMIT 50`;
        const { rows: annoncesRows } = await pool.query(annonceQuery, params);

        const annonceMsgs = annoncesRows.map(a => {
          let extra = '';
          if (a.filiere_nom) extra += `\n\n📍 Filière : ${a.filiere_nom}`;
          if (a.niveau) extra += `\n🎓 Niveau : ${a.niveau}`;
          return {
            id: 'ann_' + a.id,
            canal_id: parseInt(id),
            auteur_id: a.auteur_id,
            prenoms: a.prenoms || 'Administration',
            nom: a.nom || 'IST',
            contenu: `📢 **${a.titre}**\n\n${a.contenu}${extra}`,
            type: 'annonce',
            created_at: a.created_at,
            reactions: [],
            epingle: false
          };
        });

        const allMsgs = [...msgs, ...annonceMsgs];
        allMsgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return res.json({ success: true, data: allMsgs.slice(-limite) });
      } catch (annErr) {
        console.warn('[getMessagesCanal] Erreur chargement annonces dans canal:', annErr.message);
      }
    }

    res.json({ success: true, data: msgs.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── POST /api/messages/canal/:id ─────────────────────────
// Envoyer un message dans un canal (fallback REST si WebSocket échoue)
const envoyerMessageCanal = async (req, res) => {
  const { id } = req.params;
  const { contenu } = req.body;

  if (!contenu?.trim()) {
    return res.status(400).json({ success: false, error: 'Contenu requis' });
  }

  try {
    // Vérifier les droits de lecture (membre, canal public, ou rôle autorisé)
    if (!(await accesCanal(id, req.user.id, req.user.role, req.etablissementId))) {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }

    const canal = await ensureCanalExists(id, req.etablissementId);
    if (!(await peutEcrireCanal(canal, req.user.id, req.user.role))) {
      return res.status(403).json({
        success: false,
        error: 'Seuls l\'administration et le(s) délégué(s)/adjoint(s) de ce niveau peuvent écrire dans ce canal.',
      });
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO messages (canal_id, auteur_id, contenu, type, created_at)
       VALUES ($1, $2, $3, 'canal', NOW())
       RETURNING id, canal_id, auteur_id, contenu, created_at`,
      [id, req.user.id, contenu.trim()]
    );
    const msgId = inserted[0].id;

    // ✅ etudiant_role + niveau + photo_url ajoutés pour que badge et photo
    // apparaissent immédiatement dans le message émis via WebSocket.
    const { rows: fullMsgs } = await pool.query(
      `SELECT m.id, m.canal_id, m.auteur_id, m.contenu, m.type, m.created_at,
              u.prenoms, u.nom, u.role, u.etudiant_role, u.photo_url,
              COALESCE(e.niveau, u.niveau) AS niveau
       FROM messages m
       JOIN users u ON u.id = m.auteur_id
       LEFT JOIN etudiants e ON e.user_id = u.id
       WHERE m.id = $1`,
      [msgId]
    );
    const message = fullMsgs[0] || inserted[0];

    // Émettre via Socket.io si disponible
    const io = req.app.get('io');
    if (io) io.to(`canal:${id}`).emit('message:canal', message);

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/prives ──────────────────────────────
// Liste des conversations privées de l'utilisateur
const getConversationsPrivees = async (req, res) => {
  try {
    const pConv = [req.user.id];
    const etabConv = etabSql(pConv, req.etablissementId, 'u');
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (correspondant_id)
              correspondant_id,
              u.prenoms, u.nom, u.role, u.matricule, u.domaine,
              COALESCE(e.filiere_nom, u.filiere_nom, '') AS filiere_nom,
              mp.contenu AS dernier_message,
              mp.created_at,
              mp.is_read,
              mp.expediteur_id
       FROM (
         SELECT
           CASE WHEN expediteur_id = $1 THEN destinataire_id ELSE expediteur_id END AS correspondant_id,
           contenu, created_at, is_read, expediteur_id
         FROM messages_prives
         WHERE expediteur_id = $1 OR destinataire_id = $1
       ) mp
       JOIN users u ON u.id = mp.correspondant_id
       LEFT JOIN etudiants e ON e.user_id = u.id
       WHERE 1=1${etabConv}
       ORDER BY correspondant_id, mp.created_at DESC`,
      pConv
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/prives/:userId ─────────────────────
// Messages d'une conversation privée
const getMessagesPrives = async (req, res) => {
  const { userId } = req.params;
  const limite = parseInt(req.query.limite) || 50;

  try {
    const { rows } = await pool.query(
      `SELECT mp.id, mp.contenu, mp.created_at, mp.is_read,
              mp.expediteur_id, mp.destinataire_id,
              u.prenoms, u.nom, u.role, u.photo_url,
              COALESCE((SELECT JSON_AGG(r.emoji) FROM reactions r
                        WHERE r.message_id = mp.id AND r.message_type = 'prive'), '[]') AS reactions,
              EXISTS (SELECT 1 FROM messages_epingles me WHERE me.message_id = mp.id AND me.message_type = 'prive') AS epingle
       FROM messages_prives mp
       JOIN users u ON u.id = mp.expediteur_id
       WHERE ((mp.expediteur_id = $1 AND mp.destinataire_id = $2)
          OR (mp.expediteur_id = $2 AND mp.destinataire_id = $1))
         AND NOT EXISTS (
           SELECT 1 FROM messages_masques mm
           WHERE mm.message_id = mp.id AND mm.message_type = 'prive' AND mm.user_id = $1
         )
       ORDER BY mp.created_at DESC
       LIMIT $3`,
      [req.user.id, userId, limite]
    );
    res.json({ success: true, data: rows.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── POST /api/messages/prives/:userId ────────────────────
// Envoyer un message privé (fallback REST)
const envoyerMessagePrive = async (req, res) => {
  const { userId } = req.params;
  const { contenu } = req.body;

  if (!contenu?.trim()) {
    return res.status(400).json({ success: false, error: 'Contenu requis' });
  }

  try {
    if (!(await userDeMonEtab(userId, req.etablissementId))) {
      return res.status(403).json({ success: false, error: 'Destinataire introuvable.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO messages_prives (expediteur_id, destinataire_id, contenu, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, expediteur_id, destinataire_id, contenu, created_at`,
      [req.user.id, userId, contenu.trim()]
    );

    const { rows: senderRows } = await pool.query(
      `SELECT prenoms, nom, role FROM users WHERE id = $1`,
      [req.user.id]
    );

    const messageComplet = {
      ...rows[0],
      prenoms: senderRows[0]?.prenoms || req.user.prenoms || '',
      nom: senderRows[0]?.nom || req.user.nom || '',
      role: senderRows[0]?.role || req.user.role || '',
    };

    // userId est un UUID : ne surtout pas le convertir en entier
    const io = req.app.get('io');
    if (io) notifierUser(io, userId, 'message:prive', messageComplet);

    res.status(201).json({ success: true, data: messageComplet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── POST /api/messages/prives/read/:userId ──────────────────
// Marquer les messages d'une conversation comme lus
const marquerMessagesPrivesLus = async (req, res) => {
  const { userId } = req.params;
  try {
    await pool.query(
      `UPDATE messages_prives 
       SET is_read = TRUE 
       WHERE expediteur_id = $1 AND destinataire_id = $2 AND is_read = FALSE`,
      [userId, req.user.id]
    );

    const io = req.app.get('io');
    if (io) notifierUser(io, userId, 'message:read', { destinataire_id: req.user.id });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── POST /api/messages/canaux/:id/membres ─────────────────
// Ajouter un utilisateur à un canal (ex: prof, admin)
const ajouterMembreCanal = async (req, res) => {
  const { id } = req.params;
  const { userId, role } = req.body; // role = 'membre' ou 'admin'

  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID requis' });
  }

  try {
    // Vérification basique des droits (seul un admin ou prof devrait faire ça, à affiner selon logique métier)
    if (req.user.role !== 'admin' && req.user.role !== 'professeur') {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }

    if (req.etablissementId) {
      const c = await ensureCanalExists(id, req.etablissementId);
      if (!c || (c.etablissement_id && String(c.etablissement_id) !== String(req.etablissementId)) ||
          !(await userDeMonEtab(userId, req.etablissementId))) {
        return res.status(403).json({ success: false, error: 'Accès refusé' });
      }
    }
    await pool.query(
      `INSERT INTO canal_membres (canal_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (canal_id, user_id) DO NOTHING`,
      [id, userId, role || 'membre']
    );

    res.json({ success: true, message: 'Membre ajouté' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};
// ── GET /api/messages/groupe/mes-filieres ────────────────
// Filières enseignées par le professeur connecté
const getProfFilieres = async (req, res) => {
  try {
    const role = String(req.user.role || '').toLowerCase();
    if (!['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Accès réservé aux professeurs' });
    }
    // ✅ CORRIGÉ — utilisait module_professeur (table jamais renseignée),
    // ce qui déclenchait systématiquement le filet de sécurité "toutes les
    // filières" ci-dessous pour CHAQUE professeur, quelle que soit sa
    // véritable affectation. Utilise désormais professeur_modules, la
    // vraie table d'affectation (module + niveau + semestre). Le filet de
    // sécurité "toutes les filières" est retiré : un prof sans aucun
    // module affecté ne doit voir aucune filière ici, pas toutes.
    const pPF = [req.user.id];
    const etabPF = etabSql(pPF, req.etablissementId, 'f');
    const { rows } = await pool.query(
      `SELECT DISTINCT f.id, f.nom, f.description
       FROM professeur_modules pm
       JOIN filieres f ON f.id = pm.filiere_id
       WHERE pm.professeur_id = $1${etabPF}
       ORDER BY f.nom`,
      pPF
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[getProfFilieres]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// Messages du groupe filière
const getMessagesGroupe = async (req, res) => {
  const { filiereId } = req.params;
  const limite = parseInt(req.query.limite) || 50;

  try {
    if (!(await filiereDeMonEtab(filiereId, req.etablissementId))) {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }
    const role = String(req.user.role || '').toLowerCase();
    const isStaff = ['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(role);

    // Vérifier que l'utilisateur appartient à la filière (étudiant) ou est staff
    const appartientJwt = req.user.filiere_id != null &&
      String(req.user.filiere_id) === String(filiereId);
    const { rows: check } = (appartientJwt || isStaff)
      ? { rows: [{ ok: true }] }
      : await pool.query(
          `SELECT 1 FROM etudiants WHERE user_id = $1 AND filiere_id = $2`,
          [req.user.id, filiereId]
        );
    if (!check.length) {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }

    // ✅ etudiant_role + niveau + photo_url ajoutés pour badge et photo.
    const { rows } = await pool.query(
      `SELECT mg.id, mg.contenu, mg.created_at,
              mg.auteur_id, u.prenoms, u.nom, u.etudiant_role, u.photo_url,
              COALESCE(MAX(e.niveau), u.niveau) AS niveau,
              COALESCE(
                JSON_AGG(r.emoji) FILTER (WHERE r.emoji IS NOT NULL), '[]'
              ) AS reactions,
              EXISTS (SELECT 1 FROM messages_epingles me WHERE me.message_id = mg.id AND me.message_type = 'groupe') AS epingle
      FROM messages_groupe mg
      JOIN users u ON u.id = mg.auteur_id
      LEFT JOIN etudiants e ON e.user_id = u.id
      LEFT JOIN reactions r ON r.message_id = mg.id AND r.message_type = 'groupe'
      WHERE mg.filiere_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM messages_masques mm
          WHERE mm.message_id = mg.id AND mm.message_type = 'groupe' AND mm.user_id = $3
        )
      GROUP BY mg.id, u.id
      ORDER BY mg.created_at DESC
      LIMIT $2`,
      [filiereId, limite, req.user.id]
    );
    res.json({ success: true, data: rows.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── POST /api/messages/groupe/:filiereId ─────────────────
// Envoyer dans le groupe filière (fallback REST)
const envoyerMessageGroupe = async (req, res) => {
  const { filiereId } = req.params;
  const { contenu } = req.body;

  if (!contenu?.trim()) {
    return res.status(400).json({ success: false, error: 'Contenu requis' });
  }

  try {
    if (!(await filiereDeMonEtab(filiereId, req.etablissementId))) {
      return res.status(403).json({ success: false, error: 'Vous n\'appartenez pas à cette filière' });
    }
    const role = String(req.user.role || '').toLowerCase();
    const isStaff = ['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(role);

    const appartientJwt = req.user.filiere_id != null &&
      String(req.user.filiere_id) === String(filiereId);
    const { rows: check } = (appartientJwt || isStaff)
      ? { rows: [{ ok: true }] }
      : await pool.query(
          `SELECT 1 FROM etudiants WHERE user_id = $1 AND filiere_id = $2`,
          [req.user.id, filiereId]
        );
    if (!check.length) {
      return res.status(403).json({ success: false, error: 'Vous n\'appartenez pas à cette filière' });
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO messages_groupe (filiere_id, auteur_id, contenu, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, filiere_id, auteur_id, contenu, created_at`,
      [filiereId, req.user.id, contenu.trim()]
    );

    // ✅ etudiant_role + niveau + photo_url ajoutés pour que badge et photo
    // apparaissent immédiatement dans le message émis via WebSocket.
    const { rows: userRows } = await pool.query(
      `SELECT u.prenoms, u.nom, u.etudiant_role, u.photo_url, COALESCE(e.niveau, u.niveau) AS niveau
       FROM users u LEFT JOIN etudiants e ON e.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    const messageAvecAuteur = {
      ...inserted[0],
      prenoms: userRows[0]?.prenoms,
      nom: userRows[0]?.nom,
      etudiant_role: userRows[0]?.etudiant_role,
      photo_url: userRows[0]?.photo_url,
      niveau: userRows[0]?.niveau,
    };

    const io = req.app.get('io');
    if (io) io.to(`filiere:${filiereId}`).emit('message:groupe', messageAvecAuteur);

    res.status(201).json({ success: true, data: messageAvecAuteur });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── POST /api/messages/:id/reaction ──────────────────────
// body: { emoji, type: 'canal' | 'groupe' | 'prive' (défaut 'canal'),
//         canalId? (type='canal'), filiereId? (type='groupe'),
//         destinataireId? (type='prive', pour notifier l'autre utilisateur) }
const ajouterReaction = async (req, res) => {
  const { id } = req.params;
  const { emoji, canalId, filiereId, destinataireId } = req.body;
  const type = req.body.type || 'canal';

  if (!emoji) return res.status(400).json({ success: false, error: 'Emoji requis' });
  if (!['canal', 'groupe', 'prive'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Type de message invalide' });
  }

  try {
    // ✅ CORRIGÉ — la clause ON CONFLICT doit correspondre EXACTEMENT à la
    // contrainte unique réelle de la table (message_id, user_id, emoji,
    // message_type). Avec seulement 3 colonnes ici, Postgres ne trouvait
    // aucune contrainte correspondante et renvoyait une erreur 500 à
    // chaque tentative de réaction — donc rien n'était jamais enregistré.
    await pool.query(
      `INSERT INTO reactions (message_id, user_id, emoji, message_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id, emoji, message_type) DO NOTHING`,
      [id, req.user.id, emoji, type]
    );

    const io = req.app.get('io');
    const payload = { messageId: id, userId: req.user.id, emoji, type };
    if (io) {
      if (type === 'canal' && canalId) {
        io.to(`canal:${canalId}`).emit('reaction:ajout', payload);
      } else if (type === 'groupe' && filiereId) {
        io.to(`filiere:${filiereId}`).emit('reaction:ajout', payload);
      } else if (type === 'prive' && destinataireId) {
        notifierUser(io, destinataireId, 'reaction:ajout', payload);
      }
    }

    res.json({ success: true, message: 'Réaction ajoutée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── PATCH /api/messages/:type/:id/epingle ─────────────────
// body: { epingle: true|false }. type = 'canal' | 'groupe' | 'prive'.
// Canal / groupe filière : réservé à l'administration et aux professeurs
// (qui ont accès au canal). Conversation privée : l'un des deux participants.
const epinglerMessage = async (req, res) => {
  const { type, id } = req.params;
  const epingle = req.body.epingle !== false;
  const cfg = TABLE_PAR_TYPE[type];
  if (!cfg) return res.status(400).json({ success: false, error: 'Type de message invalide' });
  try {
    const { rows } = await pool.query(
      type === 'prive'
        ? `SELECT expediteur_id, destinataire_id FROM messages_prives WHERE id = $1`
        : `SELECT ${cfg.roomCol} AS contexte FROM ${cfg.table} WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Message introuvable' });

    const role = String(req.user.role || '').toLowerCase();
    const isStaff = ['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(role);
    let room = null;

    if (type === 'prive') {
      const m = rows[0];
      if (String(m.expediteur_id) !== String(req.user.id) && String(m.destinataire_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, error: 'Non autorisé' });
      }
    } else {
      if (!isStaff) return res.status(403).json({ success: false, error: 'Seuls l\'administration et les professeurs peuvent épingler.' });
      if (type === 'canal') {
        if (!(await accesCanal(rows[0].contexte, req.user.id, req.user.role, req.etablissementId))) {
          return res.status(403).json({ success: false, error: 'Accès refusé' });
        }
        room = `canal:${rows[0].contexte}`;
      } else {
        if (!(await filiereDeMonEtab(rows[0].contexte, req.etablissementId))) {
          return res.status(403).json({ success: false, error: 'Accès refusé' });
        }
        room = `filiere:${rows[0].contexte}`;
      }
    }

    if (epingle) {
      await pool.query(
        `INSERT INTO messages_epingles (message_id, message_type, epingle_par)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, message_type) DO NOTHING`,
        [id, type, req.user.id]
      );
    } else {
      await pool.query(
        `DELETE FROM messages_epingles WHERE message_id = $1 AND message_type = $2`,
        [id, type]
      );
    }

    const io = req.app.get('io');
    if (io) {
      const payload = { messageId: id, type, epingle };
      if (room) io.to(room).emit('message:epingle', payload);
      else {
        const autre = String(rows[0].expediteur_id) === String(req.user.id) ? rows[0].destinataire_id : rows[0].expediteur_id;
        notifierUser(io, autre, 'message:epingle', payload);
      }
    }
    res.json({ success: true, epingle });
  } catch (err) {
    console.error('[epinglerMessage]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── POST /api/messages/:type/:id/masquer ──────────────────
// "Supprimer pour moi" : masque CE message uniquement pour l'utilisateur
// courant — les autres continuent de le voir normalement. Pour l'instant
// pris en compte uniquement par getMessagesCanal (type='canal') ; à
// répliquer sur getMessagesGroupe/getMessagesPrives si besoin plus tard.
const masquerMessage = async (req, res) => {
  const { type, id } = req.params;
  try {
    await pool.query(
      `INSERT INTO messages_masques (message_id, message_type, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, message_type, user_id) DO NOTHING`,
      [id, type, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[masquerMessage]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── DELETE /api/messages/:id ──────────────────────────────
// (ancienne route, conservée pour compatibilité — canaux uniquement)
const supprimerMessage = async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT auteur_id, canal_id FROM messages WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Message introuvable' });
    }
    if (rows[0].auteur_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Non autorisé' });
    }

    await pool.query(`DELETE FROM messages WHERE id = $1`, [id]);

    const io = req.app.get('io');
    if (io) io.to(`canal:${rows[0].canal_id}`).emit('message:supprimer', { messageId: id });

    res.json({ success: true, message: 'Message supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── DELETE /api/messages/:type/:id ─────────────────────────
// "Supprimer pour tout le monde" — version générique couvrant les 3 tables
// de messages (canal, groupe filière, privé). Seul l'auteur (ou un admin)
// peut supprimer. Utiliser cette route plutôt que DELETE /:id pour
// groupe/prive — celle-ci ne connaît que la table `messages` (canaux).
const TABLE_PAR_TYPE = {
  canal:  { table: 'messages',        auteurCol: 'auteur_id',     roomCol: 'canal_id' },
  groupe: { table: 'messages_groupe', auteurCol: 'auteur_id',     roomCol: 'filiere_id' },
  prive:  { table: 'messages_prives', auteurCol: 'expediteur_id', roomCol: 'destinataire_id' },
};

const supprimerMessageType = async (req, res) => {
  const { type, id } = req.params;
  const cfg = TABLE_PAR_TYPE[type];
  if (!cfg) return res.status(400).json({ success: false, error: 'Type de message invalide' });

  try {
    const { rows } = await pool.query(
      `SELECT ${cfg.auteurCol} AS auteur_id, ${cfg.roomCol} AS contexte FROM ${cfg.table} WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Message introuvable' });
    }
    if (rows[0].auteur_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Non autorisé' });
    }

    await pool.query(`DELETE FROM ${cfg.table} WHERE id = $1`, [id]);

    const io = req.app.get('io');
    if (io) {
      const payload = { messageId: id, type };
      if (type === 'canal') io.to(`canal:${rows[0].contexte}`).emit('message:supprimer', payload);
      else if (type === 'groupe') io.to(`filiere:${rows[0].contexte}`).emit('message:supprimer', payload);
      else if (type === 'prive') notifierUser(io, rows[0].contexte, 'message:supprimer', payload);
    }

    res.json({ success: true, message: 'Message supprimé' });
  } catch (err) {
    console.error('[supprimerMessageType]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/admin-contact ───────────────────────
// Renvoie l'identité du compte administration à contacter en privé
const getAdminContact = async (req, res) => {
  try {
    const pAc = [];
    const etabAc = etabSql(pAc, req.etablissementId, 'users');
    const { rows } = await pool.query(
      `SELECT id, nom, prenoms FROM users WHERE role = 'admin'${etabAc} ORDER BY matricule NULLS LAST LIMIT 1`,
      pAc
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Aucun administrateur disponible' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/admin-contacts ───────────────────────
// Renvoie tous les comptes de l'administration disponibles
const getAdminContacts = async (req, res) => {
  try {
    const pAcs = [];
    const etabAcs = etabSql(pAcs, req.etablissementId, 'users');
    const { rows } = await pool.query(
      `SELECT id, nom, prenoms, email, tel, COALESCE(domaine, 'Administration') AS domaine, role
       FROM users
       WHERE role = 'admin' AND COALESCE(statut, 'actif') = 'actif'${etabAcs}
       ORDER BY matricule NULLS LAST, nom ASC`,
      pAcs
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[getAdminContacts]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/contacts ───────────────────────────
// Récupère la liste des contacts adressables selon le rôle
const getContacts = async (req, res) => {
  try {
    const filterRole = req.query.role ? String(req.query.role).toLowerCase().trim() : null;
    const search = req.query.q ? `%${String(req.query.q).trim().toLowerCase()}%` : null;
    const currentUserId = req.user.id;

    // 1. Récupération des professeurs
    let profs = [];
    if (!filterRole || filterRole === 'professeur' || filterRole === 'prof') {
      let profQuery = `
        SELECT u.id, u.nom, u.prenoms, u.email, u.tel, u.domaine, 'professeur' AS role,
               COALESCE(p.specialite, u.domaine, 'Enseignant') AS specialite,
               COALESCE(
                 json_agg(DISTINCT json_build_object('filiere_id', f.id, 'filiere_nom', f.nom))
                 FILTER (WHERE f.id IS NOT NULL), '[]'
               ) AS filieres
        FROM users u
        LEFT JOIN professeurs p ON p.user_id = u.id
        LEFT JOIN module_professeur mp ON mp.professeur_id = p.id
        LEFT JOIN modules m ON m.id = mp.module_id
        LEFT JOIN filieres f ON f.id = m.filiere_id
        WHERE u.role IN ('professeur', 'prof', 'enseignant')
          AND COALESCE(u.statut, 'actif') = 'actif'
          AND u.id != $1
      `;
      const params = [currentUserId];
      profQuery += etabSql(params, req.etablissementId, 'u');
      if (search) {
        params.push(search);
        profQuery += ` AND (LOWER(u.nom) LIKE $${params.length} OR LOWER(u.prenoms) LIKE $${params.length} OR LOWER(COALESCE(p.specialite, '')) LIKE $${params.length})`;
      }
      profQuery += ` GROUP BY u.id, u.nom, u.prenoms, u.email, u.tel, u.domaine, p.specialite ORDER BY u.nom ASC`;
      const { rows } = await pool.query(profQuery, params);
      profs = rows;
    }

    // 2. Récupération de l'administration
    let admins = [];
    if (!filterRole || filterRole === 'admin' || filterRole === 'administration') {
      let adminQuery = `
        SELECT u.id, u.nom, u.prenoms, u.email, u.tel, COALESCE(u.domaine, 'Administration') AS domaine, 'admin' AS role
        FROM users u
        WHERE u.role = 'admin'
          AND COALESCE(u.statut, 'actif') = 'actif'
          AND u.id != $1
      `;
      const params = [currentUserId];
      adminQuery += etabSql(params, req.etablissementId, 'u');
      if (search) {
        params.push(search);
        adminQuery += ` AND (LOWER(u.nom) LIKE $${params.length} OR LOWER(u.prenoms) LIKE $${params.length} OR LOWER(COALESCE(u.domaine, '')) LIKE $${params.length})`;
      }
      adminQuery += ` ORDER BY u.matricule NULLS LAST, u.nom ASC`;
      const { rows } = await pool.query(adminQuery, params);
      admins = rows;
    }

    // 3. Récupération des étudiants
    let etudiants = [];
    if (!filterRole || filterRole === 'etudiant') {
      let etuQuery = `
        SELECT u.id, u.nom, u.prenoms, u.matricule, u.email, u.tel, u.niveau,
               COALESCE(u.etudiant_role, 'etudiant') AS etudiant_role,
               COALESCE(e.filiere_nom, u.filiere_nom, '') AS filiere_nom,
               e.filiere_id, 'etudiant' AS role
        FROM users u
        LEFT JOIN etudiants e ON e.user_id = u.id
        WHERE (u.role = 'etudiant' OR u.role IS NULL OR u.role = '')
          AND COALESCE(u.statut, 'actif') = 'actif'
          AND u.id != $1
      `;
      const params = [currentUserId];
      etuQuery += etabSql(params, req.etablissementId, 'u');
      if (req.query.filiere_id) {
        params.push(req.query.filiere_id);
        etuQuery += ` AND (e.filiere_id = $${params.length} OR u.filiere_id = $${params.length})`;
      }
      if (search) {
        params.push(search);
        etuQuery += ` AND (LOWER(u.nom) LIKE $${params.length} OR LOWER(u.prenoms) LIKE $${params.length} OR LOWER(COALESCE(u.matricule, '')) LIKE $${params.length})`;
      }
      etuQuery += ` ORDER BY u.nom ASC LIMIT 250`;
      const { rows } = await pool.query(etuQuery, params);
      etudiants = rows;
    }

    if (filterRole === 'professeur' || filterRole === 'prof') {
      return res.json({ success: true, data: profs });
    }
    if (filterRole === 'admin' || filterRole === 'administration') {
      return res.json({ success: true, data: admins });
    }
    if (filterRole === 'etudiant') {
      return res.json({ success: true, data: etudiants });
    }

    res.json({
      success: true,
      data: {
        professeurs: profs,
        administration: admins,
        etudiants: etudiants,
        total: profs.length + admins.length + etudiants.length,
      }
    });
  } catch (err) {
    console.error('[getContacts]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/online ──────────────────────────────
// Liste des utilisateurs en ligne
const getUsersOnline = (req, res) => {
  const { getOnlineUsers } = require('../socket/socketHandler');
  res.json({ success: true, data: getOnlineUsers() });
};

// ── GET /api/messages/groupe/:filiereId/membres ──────────
// Vrais étudiants de la MÊME filière ET du MÊME niveau que le demandeur
// (remplace l'ancienne liste codée en dur côté Flutter dans
// groupe_filiere_screen.dart). Scopé par niveau, pas juste par filière —
// sinon le nombre de membres ne correspond pas à ce que l'admin voit pour
// une filière+niveau précis (ex. "Licence 2").
const getMembresGroupe = async (req, res) => {
  const { filiereId } = req.params;
  try {
    if (!(await filiereDeMonEtab(filiereId, req.etablissementId))) {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }
    const role = String(req.user.role || '').toLowerCase();
    const isStaff = ['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(role);
    const appartientJwt = req.user.filiere_id != null &&
      String(req.user.filiere_id) === String(filiereId);
    const { rows: check } = (appartientJwt || isStaff)
      ? { rows: [{ ok: true }] }
      : await pool.query(
          `SELECT 1 FROM etudiants WHERE user_id = $1 AND filiere_id = $2`,
          [req.user.id, filiereId]
        );
    if (!check.length) {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }

    // Niveau du demandeur — le staff (admin/prof) voit tout le monde,
    // un étudiant ne voit que sa propre classe (filière + niveau).
    let niveauFiltre = null;
    if (!isStaff) {
      const moiRes = await pool.query('SELECT niveau FROM etudiants WHERE user_id = $1', [req.user.id]);
      niveauFiltre = moiRes.rows[0]?.niveau || null;
    }

    const { rows } = await pool.query(
      `SELECT u.id AS user_id, e.matricule, e.nom, e.prenoms, u.photo_url,
              u.etudiant_role, e.niveau
       FROM etudiants e
       JOIN users u ON u.id = e.user_id
       WHERE e.filiere_id = $1
         AND ($2::text IS NULL OR e.niveau = $2)
         AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye')
       ORDER BY e.nom, e.prenoms`,
      [filiereId, niveauFiltre]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[getMembresGroupe]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── PATCH /api/messages/groupe/:filiereId/lu ─────────────
// Marque l'instant présent comme "dernier message lu" pour cet utilisateur
// dans ce groupe — sert de base au compteur de messages non lus.
const marquerGroupeLu = async (req, res) => {
  const { filiereId } = req.params;
  try {
    await pool.query(
      `INSERT INTO groupe_filiere_lectures (user_id, filiere_id, dernier_lu)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, filiere_id) DO UPDATE SET dernier_lu = now()`,
      [req.user.id, filiereId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[marquerGroupeLu]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/groupe/:filiereId/non-lus/count ────
const getNombreNonLusGroupe = async (req, res) => {
  const { filiereId } = req.params;
  try {
    const dernierLuRes = await pool.query(
      `SELECT dernier_lu FROM groupe_filiere_lectures WHERE user_id = $1 AND filiere_id = $2`,
      [req.user.id, filiereId]
    );
    const dernierLu = dernierLuRes.rows[0]?.dernier_lu || null;

    const result = await pool.query(
      dernierLu
        ? `SELECT COUNT(*) FROM messages_groupe WHERE filiere_id = $1 AND created_at > $2 AND auteur_id != $3`
        : `SELECT COUNT(*) FROM messages_groupe WHERE filiere_id = $1 AND auteur_id != $2`,
      dernierLu ? [filiereId, dernierLu, req.user.id] : [filiereId, req.user.id]
    );
    res.json({ success: true, count: parseInt(result.rows[0].count, 10) || 0 });
  } catch (err) {
    console.error('[getNombreNonLusGroupe]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── "Vu par" — marquage et consultation des lecteurs d'un message ───────
// :type = 'canal' | 'groupe' | 'prive'. Un seul mécanisme générique pour
// les trois familles de messages, sans toucher à leurs tables respectives.

// POST /api/messages/:type/:id/lu — marque CE message comme lu par moi.
const marquerMessageLu = async (req, res) => {
  const { type, id } = req.params;
  try {
    await pool.query(
      `INSERT INTO messages_lectures (message_id, message_type, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, message_type, user_id) DO NOTHING`,
      [id, type, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[marquerMessageLu]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// GET /api/messages/:type/:id/lecteurs — qui a vu ce message, à quelle heure.
const getLecteursMessage = async (req, res) => {
  const { type, id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.nom, u.prenoms, u.photo_url, l.lu_at
       FROM messages_lectures l
       JOIN users u ON u.id = l.user_id
       WHERE l.message_id = $1 AND l.message_type = $2
       ORDER BY l.lu_at ASC`,
      [id, type]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[getLecteursMessage]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

module.exports = {
  getCanaux,
  getMessagesCanal,
  envoyerMessageCanal,
  getConversationsPrivees,
  getMessagesPrives,
  envoyerMessagePrive,
  marquerMessagesPrivesLus,
  ajouterMembreCanal,
  getMessagesGroupe,
  envoyerMessageGroupe,
  getMembresGroupe,
  marquerGroupeLu,
  getNombreNonLusGroupe,
  marquerMessageLu,
  getLecteursMessage,
  getProfFilieres,
  ajouterReaction,
  masquerMessage,
  epinglerMessage,
  supprimerMessage,
  supprimerMessageType,
  getAdminContact,
  getAdminContacts,
  getContacts,
  getUsersOnline,
  getCanauxStandard,
};