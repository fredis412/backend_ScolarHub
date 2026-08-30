// ============================================================
// src/controllers/messageController.js
// ZOUNGRANA Jalil — Contrôleur REST Messagerie
// ============================================================

const pool = require('../config/db');
const supabase = require('../config/supabase');
const { notifierUser } = require('../socket/socketHandler');

const { resolveFiliere, normalizeNiveau } = require('../utils/filieres');

// Types de canaux « publics » : lisibles par tout utilisateur authentifié,
// sans inscription préalable dans canal_membres (les droits d'écriture
// restent gérés par rôle côté app / canal_membres).
const CANAUX_PUBLICS = ['administration', 'admin_filiere', 'bde', 'general', 'professeurs'];

// Vérifie l'accès d'un utilisateur à un canal : membre, ou canal public.
async function accesCanal(canalId, userId) {
  const { rows: membre } = await pool.query(
    `SELECT role FROM canal_membres WHERE canal_id = $1 AND user_id = $2`,
    [canalId, userId]
  );
  if (membre.length) return true;
  const { rows: canal } = await pool.query(
    `SELECT 1 FROM canaux
     WHERE id = $1
        AND (type IN ('administration', 'admin_filiere', 'bde', 'general', 'professeurs')
          OR type LIKE 'prof_delegues:%')`,
    [canalId]
  );
  return canal.length > 0;
}

// ── GET /api/messages/canaux ──────────────────────────────
// Liste des canaux accessibles par l'utilisateur connecté
const getCanaux = async (req, res) => {
  try {
    const { rows } = await pool.query(
            `SELECT c.id, c.nom, c.description, c.type,
              COALESCE(cm.role, 'membre') AS role,
              (SELECT COUNT(*) FROM messages m WHERE m.canal_id = c.id) AS nb_messages
       FROM canaux c
             LEFT JOIN canal_membres cm ON cm.canal_id = c.id AND cm.user_id = $1
             WHERE cm.user_id IS NOT NULL
                OR c.type IN ('administration', 'admin_filiere', 'bde', 'general', 'professeurs')
       ORDER BY c.nom ASC`,
            [req.user.id]
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
    // Vérifier l'accès (membre ou canal public)
    if (!(await accesCanal(id, req.user.id))) {
      return res.status(403).json({ success: false, error: 'Accès refusé à ce canal' });
    }

    const { rows: msgs } = await pool.query(
      `SELECT m.id, m.canal_id, m.contenu, m.type, m.created_at,
              u.id AS auteur_id, u.prenoms, u.nom,
              COALESCE(
                JSON_AGG(r.emoji) FILTER (WHERE r.emoji IS NOT NULL), '[]'
              ) AS reactions
       FROM messages m
       JOIN users u ON u.id = m.auteur_id
       LEFT JOIN reactions r ON r.message_id = m.id
       WHERE m.canal_id = $1 AND COALESCE(m.type, 'canal') != 'annonce'
         ${avant ? 'AND m.created_at < $3' : ''}
       GROUP BY m.id, u.id
       ORDER BY m.created_at DESC
       LIMIT $2`,
      avant ? [id, limite, avant] : [id, limite]
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
            reactions: []
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
    // Vérifier les droits d'écriture (membre ou canal public)
    if (!(await accesCanal(id, req.user.id))) {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }

    const { data: message, error } = await supabase
      .from('messages')
      .insert({ canal_id: id, auteur_id: req.user.id, contenu: contenu.trim(), type: 'canal' })
      .select('id, canal_id, auteur_id, contenu, created_at')
      .single();
    if (error) throw error;

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
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (correspondant_id)
              correspondant_id,
              u.prenoms, u.nom,
              mp.contenu AS dernier_message,
              mp.created_at
       FROM (
         SELECT
           CASE WHEN expediteur_id = $1 THEN destinataire_id ELSE expediteur_id END AS correspondant_id,
           contenu, created_at
         FROM messages_prives
         WHERE expediteur_id = $1 OR destinataire_id = $1
       ) mp
       JOIN users u ON u.id = mp.correspondant_id
       ORDER BY correspondant_id, mp.created_at DESC`,
      [req.user.id]
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
      `SELECT mp.id, mp.contenu, mp.created_at,
              mp.expediteur_id, mp.destinataire_id,
              u.prenoms, u.nom
       FROM messages_prives mp
       JOIN users u ON u.id = mp.expediteur_id
       WHERE (mp.expediteur_id = $1 AND mp.destinataire_id = $2)
          OR (mp.expediteur_id = $2 AND mp.destinataire_id = $1)
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
    const { rows } = await pool.query(
      `INSERT INTO messages_prives (expediteur_id, destinataire_id, contenu, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, expediteur_id, destinataire_id, contenu, created_at`,
      [req.user.id, userId, contenu.trim()]
    );

    // userId est un UUID : ne surtout pas le convertir en entier
    const io = req.app.get('io');
    if (io) notifierUser(io, userId, 'message:prive', rows[0]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── GET /api/messages/groupe/:filiereId ──────────────────
// Messages du groupe filière
const getMessagesGroupe = async (req, res) => {
  const { filiereId } = req.params;
  const limite = parseInt(req.query.limite) || 50;

  try {
    // Vérifier que l'utilisateur appartient à la filière
    const appartientJwt = req.user.filiere_id != null &&
      String(req.user.filiere_id) === String(filiereId);
    const { rows: check } = appartientJwt
      ? { rows: [{ ok: true }] }
      : await pool.query(
          `SELECT 1 FROM etudiants WHERE user_id = $1 AND filiere_id = $2`,
          [req.user.id, filiereId]
        );
    if (!check.length && req.user.role !== 'admin' && req.user.role !== 'professeur') {
      return res.status(403).json({ success: false, error: 'Accès refusé' });
    }

    const { rows } = await pool.query(
      `SELECT mg.id, mg.contenu, mg.created_at,
              mg.auteur_id, u.prenoms, u.nom
       FROM messages_groupe mg
       JOIN users u ON u.id = mg.auteur_id
       WHERE mg.filiere_id = $1
       ORDER BY mg.created_at DESC
       LIMIT $2`,
      [filiereId, limite]
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
    const appartientJwt = req.user.filiere_id != null &&
      String(req.user.filiere_id) === String(filiereId);
    const { rows: check } = appartientJwt
      ? { rows: [{ ok: true }] }
      : await pool.query(
          `SELECT 1 FROM etudiants WHERE user_id = $1 AND filiere_id = $2`,
          [req.user.id, filiereId]
        );
    if (!check.length && req.user.role !== 'admin' && req.user.role !== 'professeur') {
      return res.status(403).json({ success: false, error: 'Vous n\'appartenez pas à cette filière' });
    }

    const { data: message, error } = await supabase
      .from('messages_groupe')
      .insert({ filiere_id: filiereId, auteur_id: req.user.id, contenu: contenu.trim() })
      .select('id, filiere_id, auteur_id, contenu, created_at, users(prenoms, nom)')
      .single();
    if (error) throw error;

    const messageAvecAuteur = {
      ...message,
      prenoms: message.users?.prenoms,
      nom: message.users?.nom,
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
const ajouterReaction = async (req, res) => {
  const { id } = req.params;
  const { emoji, canalId } = req.body;

  if (!emoji) return res.status(400).json({ success: false, error: 'Emoji requis' });

  try {
    await pool.query(
      `INSERT INTO reactions (message_id, user_id, emoji, message_type)
       VALUES ($1, $2, $3, 'canal')
       ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
      [id, req.user.id, emoji]
    );

    const io = req.app.get('io');
    if (io && canalId) {
      io.to(`canal:${canalId}`).emit('reaction:ajout', {
        messageId: id, userId: req.user.id, emoji
      });
    }

    res.json({ success: true, message: 'Réaction ajoutée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

// ── DELETE /api/messages/:id ──────────────────────────────
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

// ── GET /api/messages/admin-contact ───────────────────────
// Renvoie l'identité du compte administration à contacter en privé
const getAdminContact = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nom, prenoms FROM users WHERE role = 'admin' ORDER BY matricule NULLS LAST LIMIT 1`
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

// ── GET /api/messages/online ──────────────────────────────
// Liste des utilisateurs en ligne
const getUsersOnline = (req, res) => {
  const { getOnlineUsers } = require('../socket/socketHandler');
  res.json({ success: true, data: getOnlineUsers() });
};

module.exports = {
  getCanaux,
  getMessagesCanal,
  envoyerMessageCanal,
  getConversationsPrivees,
  getMessagesPrives,
  envoyerMessagePrive,
  getMessagesGroupe,
  envoyerMessageGroupe,
  ajouterReaction,
  supprimerMessage,
  getAdminContact,
  getUsersOnline,
};
