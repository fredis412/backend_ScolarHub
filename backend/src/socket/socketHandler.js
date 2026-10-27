// ============================================================
// src/socket/socketHandler.js
// ZOUNGRANA Jalil — Messagerie temps réel Socket.io
// ============================================================

const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// ── Multi-établissement ─────────────────────────────────────────────────────
// Le jeton porte etablissement_id. S'il est absent (anciens jetons), aucun
// filtre n'est appliqué — comportement historique. Les salles `canal:<id>` /
// `filiere:<id>` sont vérifiées par rapport à l'établissement du socket, et
// les présences en ligne ne sont diffusées qu'à l'établissement concerné.
const canalDeMonEtab = async (canalId, etab) => {
  if (!etab) return true;
  if (canalId === undefined || canalId === null || canalId === '') return false;
  const r = await pool.query('SELECT 1 FROM canaux WHERE id = $1 AND etablissement_id = $2', [canalId, etab]);
  return r.rows.length > 0;
};
const filiereDeMonEtab = async (filiereId, etab) => {
  if (!etab) return true;
  if (filiereId === undefined || filiereId === null || filiereId === '') return false;
  const r = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [filiereId, etab]);
  return r.rows.length > 0;
};
const userDeMonEtab = async (userId, etab) => {
  if (!etab) return true;
  if (userId === undefined || userId === null || userId === '') return false;
  const r = await pool.query('SELECT 1 FROM users WHERE id = $1 AND etablissement_id = $2', [userId, etab]);
  return r.rows.length > 0;
};

// Stocke les utilisateurs en ligne : { userId: socketId }
const onlineUsers = new Map();

// Référence globale à l'instance io, pour pousser des événements depuis
// n'importe quel contrôleur (ex. notifications) sans avoir accès à req.
let ioRef = null;

function initSocket(io) {
  ioRef = io;

  // ── Middleware d'authentification Socket ──────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Token manquant'));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      // Jeton sans établissement (ancienne session) : connexion refusée.
      if (!payload.etablissement_id) return next(new Error('Session expirée : reconnectez-vous'));
      socket.userId   = payload.id;
      socket.userRole = payload.role;
      socket.filiere  = payload.filiere_id;
      socket.etab     = payload.etablissement_id || null;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  // ── Connexion ─────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const etab = socket.etab || null;
    // Diffusion limitée à l'établissement (ou à tous si jeton sans établissement)
    const diffuserEtab = (event, data) => (etab ? io.to(`etab:${etab}`) : io).emit(event, data);
    console.log(`[Socket] Connecté : userId=${userId}`);

    // Enregistrer l'utilisateur en ligne
    onlineUsers.set(userId, socket.id);

    // Rejoindre la room personnelle (notifications)
    socket.join(`user:${userId}`);
    if (etab) socket.join(`etab:${etab}`);

    // Les étudiants rejoignent leur filière. Les comptes de gestion doivent
    // écouter toutes les filières pour recevoir les messages des groupes.
    if (socket.userRole === 'admin' || socket.userRole === 'professeur') {
      try {
        const { rows: filieres } = etab
          ? await pool.query('SELECT id FROM filieres WHERE etablissement_id = $1', [etab])
          : await pool.query('SELECT id FROM filieres');
        filieres.forEach(({ id }) => socket.join(`filiere:${id}`));
      } catch (err) {
        console.error('[Socket] Erreur chargement filières:', err.message);
      }
    } else if (socket.filiere) {
      socket.join(`filiere:${socket.filiere}`);
    }

    // ── Rejoindre une room dynamiquement ──────────────────────
    socket.on('join_room', async (data) => {
      if (data?.roomId) {
        if (etab) {
          // Une salle de canal / filière / utilisateur d'un autre établissement est refusée.
          const m = /^(canal|filiere|user|etab):(.+)$/.exec(String(data.roomId));
          if (m) {
            let ok = true;
            try {
              if (m[1] === 'canal') ok = await canalDeMonEtab(m[2], etab);
              else if (m[1] === 'filiere') ok = await filiereDeMonEtab(m[2], etab);
              else if (m[1] === 'user') ok = String(m[2]) === String(userId);
              else if (m[1] === 'etab') ok = String(m[2]) === String(etab);
            } catch (_) { ok = false; }
            if (!ok) return;
          }
        }
        socket.join(data.roomId);
        console.log(`[Socket] user:${userId} a rejoint la room: ${data.roomId}`);
      }
    });

    // Rejoindre toutes les rooms des canaux accessibles :
    // adhésions explicites + canaux publics (lisibles par tous)
    try {
      const { rows: canaux } = await pool.query(
          `SELECT c.id AS canal_id FROM canaux c
          WHERE (${etab ? 'c.etablissement_id = $3' : 'TRUE'} AND (c.type IN ('administration', 'admin_filiere', 'bde', 'general', 'professeurs', 'admin_profs', 'admin_delegues', 'prof_admin', 'prof_prof')
            OR ($2 = 'admin' AND c.type LIKE 'prof_delegues:%')
            OR (c.type LIKE 'prof_delegues:%' AND (
              $1::text IN (SELECT user_id::text FROM professeurs p
                           JOIN module_professeur mp ON mp.professeur_id = p.id
                           JOIN modules m ON m.id = mp.module_id
                      WHERE c.type = 'prof_delegues:' || m.filiere_id)
              OR $1::text IN (SELECT user_id::text FROM etudiants e
                        WHERE c.type = 'prof_delegues:' || e.filiere_id)
            ))))
         UNION
         SELECT cm.canal_id FROM canal_membres cm
           ${etab ? 'JOIN canaux cx ON cx.id = cm.canal_id AND cx.etablissement_id = $3' : ''}
           WHERE cm.user_id = $1`,
          etab ? [userId, socket.userRole, etab] : [userId, socket.userRole]
      );
      canaux.forEach(({ canal_id }) => socket.join(`canal:${canal_id}`));
    } catch (err) {
      console.error('[Socket] Erreur chargement canaux:', err.message);
    }

    // Informer les contacts que l'utilisateur est en ligne
    diffuserEtab('user:online', { userId });

    // ── Événement : envoyer un message dans un canal ──────
    socket.on('message:canal', async (data, callback) => {
      const { canalId, contenu } = data;
      if (!contenu?.trim()) return callback?.({ error: 'Contenu vide' });

      try {
        if (!(await canalDeMonEtab(canalId, etab))) return callback?.({ error: 'Accès refusé à ce canal' });

        // Vérifier que l'utilisateur a le droit d'écrire
        const normRole = String(socket.userRole || '').toLowerCase().trim();
        const isStaff = ['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(normRole);

        if (!isStaff) {
          const { rows: access } = await pool.query(
             `SELECT 1 FROM canal_membres WHERE canal_id = $1 AND user_id = $2
             UNION ALL
             SELECT 1 FROM canaux WHERE id = $1
               AND (type IN ('administration', 'admin_filiere', 'bde', 'general', 'professeurs', 'admin_profs', 'admin_delegues', 'prof_admin', 'prof_prof')
                 OR type LIKE 'prof_delegues:%')`,
             [canalId, userId]
          );
          if (!access.length) return callback?.({ error: 'Accès refusé à ce canal' });
        }

        // Persister le message
        const { rows: inserted } = await pool.query(
          `INSERT INTO messages (canal_id, auteur_id, contenu, type, created_at)
           VALUES ($1, $2, $3, 'canal', NOW())
           RETURNING id, canal_id, auteur_id, contenu, created_at`,
          [canalId, userId, contenu.trim()]
        );
        const msgId = inserted[0].id;

        const { rows: fullMsgs } = await pool.query(
          `SELECT m.id, m.canal_id, m.auteur_id, m.contenu, m.type, m.created_at,
                  u.prenoms, u.nom, u.role
           FROM messages m
           JOIN users u ON u.id = m.auteur_id
           WHERE m.id = $1`,
          [msgId]
        );
        const message = fullMsgs[0] || inserted[0];

        // Diffuser à tous les membres du canal
        io.to(`canal:${canalId}`).emit('message:canal', message);
        callback?.({ success: true, message });
      } catch (err) {
        console.error('[Socket] message:canal erreur:', err.message);
        callback?.({ error: 'Erreur serveur' });
      }
    });

    // ── Événement : message privé ─────────────────────────
    socket.on('message:prive', async (data, callback) => {
      const { destinataireId, contenu } = data;
      if (!contenu?.trim()) return callback?.({ error: 'Contenu vide' });

      try {
        if (!(await userDeMonEtab(destinataireId, etab))) return callback?.({ error: 'Destinataire introuvable' });
        const { rows } = await pool.query(
          `INSERT INTO messages_prives (expediteur_id, destinataire_id, contenu, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, expediteur_id, destinataire_id, contenu, created_at`,
          [userId, destinataireId, contenu.trim()]
        );
        const { rows: senderRows } = await pool.query(
          `SELECT prenoms, nom, role FROM users WHERE id = $1`,
          [userId]
        );
        const message = {
          ...rows[0],
          prenoms: senderRows[0]?.prenoms || '',
          nom: senderRows[0]?.nom || '',
          role: senderRows[0]?.role || '',
        };

        // Envoyer au destinataire s'il est en ligne
        const destSocketId = onlineUsers.get(destinataireId);
        if (destSocketId) {
          io.to(`user:${destinataireId}`).emit('message:prive', message);
        }

        // Confirmer à l'expéditeur
        callback?.({ success: true, message });
      } catch (err) {
        console.error('[Socket] message:prive erreur:', err.message);
        callback?.({ error: 'Erreur serveur' });
      }
    });

    // ── Événement : accusé de lecture ────────────────────
    socket.on('message:read', async (data, callback) => {
      const { expediteurId } = data;
      if (!expediteurId) return callback?.({ error: 'expediteurId requis' });

      try {
        await pool.query(
          `UPDATE messages_prives 
           SET is_read = TRUE 
           WHERE expediteur_id = $1 AND destinataire_id = $2 AND is_read = FALSE`,
          [expediteurId, userId]
        );

        // Notifier l'expéditeur que ses messages ont été lus
        io.to(`user:${expediteurId}`).emit('message:read', {
          destinataire_id: userId,
          expediteur_id: expediteurId,
        });
        callback?.({ success: true });
      } catch (err) {
        console.error('[Socket] message:read erreur:', err.message);
        callback?.({ error: 'Erreur serveur' });
      }
    });

    // ── Événement : message dans groupe filière ───────────
    socket.on('message:groupe', async (data, callback) => {
      const { filiereId, contenu } = data;
      if (!contenu?.trim()) return callback?.({ error: 'Contenu vide' });

      // Staff (admin/prof) peut écrire dans n'importe quelle filière
      // Les étudiants ne peuvent écrire que dans leur propre filière
      const normRole = String(socket.userRole || '').toLowerCase().trim();
      const isStaff = ['admin', 'professeur', 'prof', 'enseignant', 'teacher'].includes(normRole);
      if (!isStaff && String(socket.filiere) !== String(filiereId)) {
        return callback?.({ error: 'Vous n\'appartenez pas à cette filière' });
      }

      try {
        if (!(await filiereDeMonEtab(filiereId, etab))) return callback?.({ error: 'Filière introuvable' });
        const { rows } = await pool.query(
          `INSERT INTO messages_groupe (filiere_id, auteur_id, contenu, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, filiere_id, auteur_id, contenu, created_at`,
          [filiereId, userId, contenu.trim()]
        );
        const { rows: auteurs } = await pool.query(
          `SELECT mg.id, mg.filiere_id, mg.auteur_id, mg.contenu, mg.created_at,
                  u.prenoms, u.nom
           FROM messages_groupe mg
           JOIN users u ON u.id = mg.auteur_id
           WHERE mg.id = $1`,
          [rows[0].id]
        );
        const message = auteurs[0];

        // Diffuser à toute la filière
        io.to(`filiere:${filiereId}`).emit('message:groupe', message);
        callback?.({ success: true, message });
      } catch (err) {
        console.error('[Socket] message:groupe erreur:', err.message);
        callback?.({ error: 'Erreur serveur' });
      }
    });

    // ── Événement : réaction emoji ────────────────────────
    socket.on('reaction:ajout', async (data, callback) => {
      const { messageId, emoji, messageType } = data;

      try {
        if (data.canalId && !(await canalDeMonEtab(data.canalId, etab))) {
          return callback?.({ error: 'Accès refusé à ce canal' });
        }
        await pool.query(
          `INSERT INTO reactions (message_id, user_id, emoji, message_type)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
          [messageId, userId, emoji, messageType || 'canal']
        );

        // Diffuser la réaction à la room concernée
        const room = data.canalId ? `canal:${data.canalId}` : `filiere:${socket.filiere}`;
        io.to(room).emit('reaction:ajout', { messageId, userId, emoji });
        callback?.({ success: true });
      } catch (err) {
        console.error('[Socket] reaction:ajout erreur:', err.message);
        callback?.({ error: 'Erreur serveur' });
      }
    });

    // ── Événement : indicateur de frappe ─────────────────
    socket.on('user:typing', async (data) => {
      const { canalId, filiereId, destinataireId } = data;
      const payload = { userId, typing: true };
      try {
        if (canalId && !(await canalDeMonEtab(canalId, etab))) return;
        if (!canalId && filiereId && !(await filiereDeMonEtab(filiereId, etab))) return;
        if (!canalId && !filiereId && destinataireId && !(await userDeMonEtab(destinataireId, etab))) return;
      } catch (_) { return; }

      if (canalId) {
        socket.to(`canal:${canalId}`).emit('user:typing', payload);
      } else if (filiereId) {
        socket.to(`filiere:${filiereId}`).emit('user:typing', payload);
      } else if (destinataireId) {
        io.to(`user:${destinataireId}`).emit('user:typing', payload);
      }
    });

    // ── Événement : supprimer un message ─────────────────
    socket.on('message:supprimer', async (data, callback) => {
      const { messageId, canalId } = data;

      try {
        // Vérifier que c'est l'auteur ou un admin
        const { rows } = await pool.query(
          `SELECT auteur_id, canal_id FROM messages WHERE id = $1`,
          [messageId]
        );
        if (!rows.length) return callback?.({ error: 'Message introuvable' });
        if (!(await canalDeMonEtab(rows[0].canal_id, etab))) return callback?.({ error: 'Message introuvable' });
        if (rows[0].auteur_id !== userId && socket.userRole !== 'admin') {
          return callback?.({ error: 'Non autorisé' });
        }

        await pool.query(`DELETE FROM messages WHERE id = $1`, [messageId]);

        io.to(`canal:${etab ? rows[0].canal_id : canalId}`).emit('message:supprimer', { messageId });
        callback?.({ success: true });
      } catch (err) {
        console.error('[Socket] message:supprimer erreur:', err.message);
        callback?.({ error: 'Erreur serveur' });
      }
    });

    // ── Déconnexion ───────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      diffuserEtab('user:offline', { userId });
      console.log(`[Socket] Déconnecté : userId=${userId}`);
    });
  });
}

// Utilitaire : envoyer une notification à un utilisateur depuis n'importe quel contrôleur
function notifierUser(io, userId, event, data) {
  io.to(`user:${userId}`).emit(event, data);
}

// Pousse un événement à un utilisateur via l'instance io globale (sans req).
// Utilisé par les contrôleurs (notifications) pour la mise à jour temps réel.
function pushToUser(userId, event, data) {
  if (ioRef) ioRef.to(`user:${userId}`).emit(event, data);
}

// Utilitaire : obtenir la liste des utilisateurs en ligne
function getOnlineUsers() {
  return Array.from(onlineUsers.keys());
}

module.exports = { initSocket, notifierUser, pushToUser, getOnlineUsers };