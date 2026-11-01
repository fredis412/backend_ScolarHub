const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');

// ════════════════════════════════════════════════════════════════════════════
// RÉCLAMATIONS — circuit en 5 étapes
//  1. L'étudiant dépose            (etape = 'admin',        statut = 'en_attente')
//  2. L'admin transmet ou rejette  (etape = 'professeur',   statut = 'en_cours')
//  3. Le professeur traite/renvoie (etape = 'verification', statut = 'en_cours')
//  4. L'admin vérifie et répond    (etape = 'termine',      statut = 'resolu')
//  5. L'étudiant reçoit la réponse
// reclamations.etudiant_id = users.id (uuid). Le professeur = users.id aussi.
// ════════════════════════════════════════════════════════════════════════════

const CATEGORIES = ['Notes & Moyennes', 'Accès & Connexion', 'Documents', 'Inscription', 'Paiement', 'Autre'];
const TYPES_LEGACY = ['note', 'moyenne', 'absence'];
// Seules ces catégories peuvent être transmises à un professeur (le reste relève de l'administration).
const CATEGORIES_TRANSMISSIBLES = ['Notes & Moyennes', 'Documents', 'Autre'];

const estAdmin = (req) => req.user.role === 'admin';
const estProf  = (req) => req.user.role === 'professeur';

function notifier(userId, titre, msg) {
  if (!userId) return;
  Promise.resolve(envoyerNotificationAuto(userId, titre, msg, 'reclamation', null))
    .catch((e) => console.error('[reclamations] notification', e.message));
}

async function notifierAdmins(req, titre, msg) {
  try {
    const params = [];
    let cond = '';
    if (req.etablissementId) { params.push(req.etablissementId); cond = ' AND etablissement_id = $1'; }
    const r = await pool.query(`SELECT id FROM users WHERE role = 'admin'${cond}`, params);
    r.rows.forEach((a) => notifier(a.id, titre, msg));
  } catch (e) { console.error('[reclamations] notifierAdmins', e.message); }
}

// Charge la réclamation si l'utilisateur y a accès selon son rôle.
async function chargerAcces(req, id) {
  const params = [id];
  let cond = '';
  if (estAdmin(req)) {
    if (req.etablissementId) { params.push(req.etablissementId); cond = ` AND u.etablissement_id = $${params.length}`; }
  } else if (estProf(req)) {
    params.push(req.user.id); cond = ` AND r.prof_id = $${params.length}`;
  } else {
    params.push(req.user.id); cond = ` AND r.etudiant_id = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT r.* FROM reclamations r JOIN users u ON u.id = r.etudiant_id WHERE r.id = $1${cond}`, params);
  return r.rows[0] || null;
}

async function prochainNumero(etabId) {
  const an = new Date().getFullYear();
  const params = [`RCL-${an}-%`];
  let cond = '';
  if (etabId) { params.push(etabId); cond = ' AND u.etablissement_id = $2'; }
  const r = await pool.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(r.numero FROM 10) AS int)), 0) + 1 AS n
     FROM reclamations r JOIN users u ON u.id = r.etudiant_id
     WHERE r.numero LIKE $1${cond}`, params);
  const n = parseInt(r.rows[0].n, 10) || 1;
  return `RCL-${an}-${String(n).padStart(3, '0')}`;
}

async function ajouterMessage(reclamationId, req, role, contenu, interne) {
  await pool.query(
    `INSERT INTO reclamation_messages (reclamation_id, auteur_id, auteur_role, contenu, interne)
     VALUES ($1,$2,$3,$4,$5)`,
    [reclamationId, req.user.id, role, contenu, !!interne]);
}

const SELECT_LISTE = `
  SELECT r.*, e.matricule, e.nom AS etudiant_nom, e.prenoms AS etudiant_prenoms,
         pu.nom AS prof_nom, pu.prenoms AS prof_prenoms,
         (SELECT COUNT(*) FROM reclamation_pieces p WHERE p.reclamation_id = r.id) AS nb_pieces
  FROM reclamations r
  JOIN users u ON u.id = r.etudiant_id
  LEFT JOIN etudiants e ON e.user_id = r.etudiant_id
  LEFT JOIN users pu ON pu.id = r.prof_id`;

// ── POST /api/reclamations (étudiant) ───────────────────────────────────────
const createReclamation = async (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body;
    const description = (b.description || b.justification || '').toString().trim();
    if (!description) return res.status(400).json({ success: false, message: 'La description est obligatoire.' });
    if (description.length > 1000) return res.status(400).json({ success: false, message: 'Description trop longue (1000 caractères max).' });

    const type = TYPES_LEGACY.includes(b.type) ? b.type : 'autre';
    let categorie = (b.categorie || '').toString().trim();
    if (!categorie) categorie = TYPES_LEGACY.includes(b.type) ? 'Notes & Moyennes' : '';
    if (!CATEGORIES.includes(categorie)) {
      return res.status(400).json({ success: false, message: 'Catégorie invalide.' });
    }
    const objet = (b.objet || '').toString().trim().slice(0, 160) || null;
    if (!objet && !TYPES_LEGACY.includes(b.type)) {
      return res.status(400).json({ success: false, message: 'L\'objet est obligatoire.' });
    }

    const etuRes = await pool.query('SELECT filiere_nom FROM etudiants WHERE user_id = $1', [userId]);
    const filiereNom = etuRes.rows[0]?.filiere_nom || null;
    const numero = await prochainNumero(req.etablissementId);

    const insert = await pool.query(
      `INSERT INTO reclamations (
         etudiant_id, module_id, module_nom, type, type_eval, note_actuelle, semestre, annee, filiere,
         parties_contestees, justification, statut, modules_contestes, numero, categorie, objet, etape
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'en_attente',$12,$13,$14,$15,'admin')
       RETURNING id, numero`,
      [userId, b.module_id?.toString() || null, b.module_nom || null, type, b.type_eval || null,
       b.note_actuelle ?? null, b.semestre || null, b.annee || null, filiereNom,
       b.parties_contestees || null, description,
       b.modules_contestes ? JSON.stringify(b.modules_contestes) : null,
       numero, categorie, objet]);

    notifierAdmins(req, 'Nouvelle réclamation', `${numero} — ${objet || categorie}`);
    res.status(201).json({ success: true, message: 'Réclamation envoyée à l\'administration.', id: insert.rows[0].id, numero });
  } catch (error) {
    console.error('[createReclamation]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi de la réclamation.' });
  }
};

// ── Vérifs avant upload d'une pièce jointe ──────────────────────────────────
const autoriserPiece = async (req, res, next) => {
  try {
    const rec = await chargerAcces(req, req.params.id);
    if (!rec || estAdmin(req) || estProf(req)) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });
    if (rec.statut === 'resolu' || rec.statut === 'rejete') {
      return res.status(400).json({ success: false, message: 'Cette réclamation est clôturée.' });
    }
    const n = await pool.query('SELECT COUNT(*) FROM reclamation_pieces WHERE reclamation_id = $1', [rec.id]);
    if (parseInt(n.rows[0].count, 10) >= 5) {
      return res.status(400).json({ success: false, message: '5 pièces jointes maximum.' });
    }
    next();
  } catch (e) {
    console.error('[autoriserPiece]', e);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

const verifierPiece = (req, res, next) => {
  const f = req.file;
  if (!f) return res.status(400).json({ success: false, message: 'Aucun fichier reçu.' });
  const ok = ['image/jpeg', 'image/png', 'application/pdf'].includes(f.mimetype);
  if (!ok) return res.status(400).json({ success: false, message: 'Formats acceptés : JPG, PNG, PDF.' });
  if (f.size && f.size > 5 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Fichier trop lourd (5 Mo max).' });
  next();
};

// POST /api/reclamations/:id/pieces (après upload)
const ajouterPiece = async (req, res) => {
  try {
    const url = req.uploadedFileUrl;
    if (!url) return res.status(500).json({ success: false, message: 'Échec de l\'envoi du fichier.' });
    await pool.query(
      `INSERT INTO reclamation_pieces (reclamation_id, nom, url, mime, taille) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, req.file.originalname || 'piece', url, req.file.mimetype, req.file.size || null]);
    // Compatibilité : première pièce aussi dans photo_url (ancien affichage)
    await pool.query(`UPDATE reclamations SET photo_url = COALESCE(photo_url, $1) WHERE id = $2`, [url, req.params.id]);
    res.status(201).json({ success: true, url });
  } catch (error) {
    console.error('[ajouterPiece]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'ajout de la pièce.' });
  }
};

// ── GET /api/reclamations/mes-reclamations (étudiant) ───────────────────────
const getMesReclamations = async (req, res) => {
  try {
    const result = await pool.query(
      `${SELECT_LISTE} WHERE r.etudiant_id = $1 ORDER BY r.created_at DESC`, [req.user.id]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[getMesReclamations]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement.' });
  }
};

// ── GET /api/reclamations (admin) ───────────────────────────────────────────
const getAllReclamations = async (req, res) => {
  try {
    const { statut } = req.query;
    const params = [];
    const conds = [];
    if (statut) { params.push(statut); conds.push(`r.statut = $${params.length}`); }
    if (req.etablissementId) { params.push(req.etablissementId); conds.push(`u.etablissement_id = $${params.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const result = await pool.query(`${SELECT_LISTE} ${where} ORDER BY r.created_at DESC`, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[getAllReclamations]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des réclamations.' });
  }
};

// ── GET /api/reclamations/professeur/mes (professeur) ───────────────────────
const getReclamationsProfesseur = async (req, res) => {
  try {
    const result = await pool.query(
      `${SELECT_LISTE} WHERE r.prof_id = $1 ORDER BY r.date_transmission DESC NULLS LAST, r.created_at DESC`,
      [req.user.id]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[getReclamationsProfesseur]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement.' });
  }
};

// ── GET /api/reclamations/en-attente/count (admin) — badge du menu ──────────
// À traiter = nouvelles (étape admin) + retours de professeur (verification)
const getNombreEnAttente = async (req, res) => {
  try {
    const params = [];
    let cond = '';
    if (req.etablissementId) { params.push(req.etablissementId); cond = ' AND u.etablissement_id = $1'; }
    const result = await pool.query(
      `SELECT COUNT(*) FROM reclamations r JOIN users u ON u.id = r.etudiant_id
       WHERE (r.statut = 'en_attente' OR r.etape = 'verification')${cond}`, params);
    res.json({ success: true, count: parseInt(result.rows[0].count, 10) || 0 });
  } catch (error) {
    console.error('[getNombreEnAttente]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du comptage.' });
  }
};

// ── GET /api/reclamations/:id (détail, selon rôle) ──────────────────────────
const getReclamation = async (req, res) => {
  try {
    const rec = await chargerAcces(req, req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });

    const liste = await pool.query(`${SELECT_LISTE} WHERE r.id = $1`, [rec.id]);
    const pieces = await pool.query(
      `SELECT id, nom, url, mime, taille, created_at FROM reclamation_pieces WHERE reclamation_id = $1 ORDER BY created_at`, [rec.id]);
    const voitInterne = estAdmin(req) || estProf(req);
    const messages = await pool.query(
      `SELECT m.id, m.auteur_id, m.auteur_role, m.contenu, m.interne, m.created_at, u.nom, u.prenoms
       FROM reclamation_messages m LEFT JOIN users u ON u.id = m.auteur_id
       WHERE m.reclamation_id = $1 ${voitInterne ? '' : 'AND m.interne = false'}
       ORDER BY m.created_at`, [rec.id]);
    res.json({ success: true, data: { ...liste.rows[0], pieces: pieces.rows, messages: messages.rows } });
  } catch (error) {
    console.error('[getReclamation]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement.' });
  }
};

// ── GET /api/reclamations/:id/professeurs (admin) ───────────────────────────
const getProfesseursCandidats = async (req, res) => {
  try {
    const rec = await chargerAcces(req, req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });

    const pe = [];
    let condEtab = '';
    if (req.etablissementId) { pe.push(req.etablissementId); condEtab = ` AND u.etablissement_id = $${pe.length}`; }

    let suggeres = [];
    if (rec.module_id) {
      try {
        const s = await pool.query(
          `SELECT DISTINCT u.id, u.nom, u.prenoms FROM professeur_modules pm
           JOIN users u ON u.id = pm.professeur_id
           WHERE CAST(pm.module_id AS text) = $${pe.length + 1}${condEtab}
           ORDER BY u.nom`, [...pe, rec.module_id.toString()]);
        suggeres = s.rows;
      } catch (e) { console.error('[candidats] suggestion', e.message); }
    }
    const t = await pool.query(
      `SELECT u.id, u.nom, u.prenoms FROM users u WHERE u.role = 'professeur'${condEtab} ORDER BY u.nom`, pe);
    res.json({ success: true, suggeres, tous: t.rows });
  } catch (error) {
    console.error('[getProfesseursCandidats]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des professeurs.' });
  }
};

// ── POST /api/reclamations/:id/messages (tous rôles) ────────────────────────
const envoyerMessage = async (req, res) => {
  try {
    const contenu = (req.body.contenu || '').toString().trim();
    if (!contenu) return res.status(400).json({ success: false, message: 'Message vide.' });
    if (contenu.length > 1000) return res.status(400).json({ success: false, message: 'Message trop long.' });
    const rec = await chargerAcces(req, req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });
    if (rec.statut === 'resolu' || rec.statut === 'rejete') {
      return res.status(400).json({ success: false, message: 'Cette réclamation est clôturée.' });
    }

    if (estAdmin(req)) {
      const interne = req.body.interne === true;
      await ajouterMessage(rec.id, req, 'admin', contenu, interne);
      if (interne) notifier(rec.prof_id, 'Réclamation ' + (rec.numero || ''), 'Nouveau message de l\'administration.');
      else notifier(rec.etudiant_id, 'Réclamation ' + (rec.numero || ''), 'L\'administration vous a écrit.');
    } else if (estProf(req)) {
      await ajouterMessage(rec.id, req, 'professeur', contenu, true);
      await notifierAdmins(req, 'Réclamation ' + (rec.numero || ''), 'Nouveau message du professeur.');
    } else {
      await ajouterMessage(rec.id, req, 'etudiant', contenu, false);
      await notifierAdmins(req, 'Réclamation ' + (rec.numero || ''), 'L\'étudiant a ajouté un message.');
    }
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[envoyerMessage]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi.' });
  }
};

// ── PATCH /api/reclamations/:id/transferer (admin) ──────────────────────────
// body: { prof_id, consigne? }
const transfererReclamation = async (req, res) => {
  try {
    const { id } = req.params;
    const { prof_id, consigne } = req.body;
    if (!prof_id) return res.status(400).json({ success: false, message: 'Le professeur destinataire est requis.' });
    const rec = await chargerAcces(req, id);
    if (!rec) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });
    if (rec.statut === 'resolu' || rec.statut === 'rejete') {
      return res.status(400).json({ success: false, message: 'Cette réclamation est déjà clôturée.' });
    }
    if (rec.categorie && !CATEGORIES_TRANSMISSIBLES.includes(rec.categorie)) {
      return res.status(400).json({
        success: false,
        message: `Une réclamation « ${rec.categorie} » est traitée par l'administration : elle ne peut pas être transmise à un professeur.`,
      });
    }
    const pp = [prof_id];
    let cond = '';
    if (req.etablissementId) { pp.push(req.etablissementId); cond = ' AND etablissement_id = $2'; }
    const p = await pool.query(`SELECT id, nom, prenoms FROM users WHERE id = $1 AND role = 'professeur'${cond}`, pp);
    if (!p.rows[0]) return res.status(404).json({ success: false, message: 'Professeur introuvable.' });
    const nomProf = `${p.rows[0].prenoms || ''} ${p.rows[0].nom || ''}`.trim();

    await pool.query(
      `UPDATE reclamations SET statut = 'en_cours', etape = 'professeur', prof_id = $1, prof_transfere = $2,
              date_transmission = now(), prof_commentaire = NULL, date_retour = NULL
       WHERE id = $3`, [prof_id, nomProf, id]);
    if (consigne && consigne.toString().trim()) {
      await ajouterMessage(id, req, 'admin', consigne.toString().trim(), true);
    }
    notifier(prof_id, 'Réclamation à traiter', `${rec.numero || 'Une réclamation'} vous a été transmise par l'administration.`);
    notifier(rec.etudiant_id, 'Réclamation en cours', `Votre réclamation ${rec.numero || ''} est en cours de traitement.`);
    res.json({ success: true, message: 'Réclamation transmise.' });
  } catch (error) {
    console.error('[transfererReclamation]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du transfert.' });
  }
};

// ── PATCH /api/reclamations/:id/retour (professeur) ─────────────────────────
// body: { commentaire }
const retourProfesseur = async (req, res) => {
  try {
    const commentaire = (req.body.commentaire || '').toString().trim();
    if (!commentaire) return res.status(400).json({ success: false, message: 'Votre commentaire est requis.' });
    const rec = await chargerAcces(req, req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });
    if (rec.etape !== 'professeur') {
      return res.status(400).json({ success: false, message: 'Cette réclamation n\'est pas en attente de votre traitement.' });
    }
    await pool.query(
      `UPDATE reclamations SET etape = 'verification', prof_commentaire = $1, date_retour = now() WHERE id = $2`,
      [commentaire, rec.id]);
    await ajouterMessage(rec.id, req, 'professeur', commentaire, true);
    await notifierAdmins(req, 'Réclamation traitée par le professeur', `${rec.numero || 'Une réclamation'} est prête à être vérifiée.`);
    res.json({ success: true, message: 'Retournée à l\'administration.' });
  } catch (error) {
    console.error('[retourProfesseur]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du retour.' });
  }
};

// ── PATCH /api/reclamations/:id/repondre (admin) ────────────────────────────
const repondreReclamation = async (req, res) => {
  try {
    const { id } = req.params;
    const reponse = (req.body.reponse || '').toString().trim();
    if (!reponse) return res.status(400).json({ success: false, message: 'La réponse est requise.' });
    const rec = await chargerAcces(req, id);
    if (!rec) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });
    if (rec.statut === 'resolu' || rec.statut === 'rejete') {
      return res.status(400).json({ success: false, message: 'Cette réclamation est déjà clôturée.' });
    }
    await pool.query(
      `UPDATE reclamations SET statut = 'resolu', etape = 'termine', reponse = $1, date_traitement = now() WHERE id = $2`,
      [reponse, id]);
    await ajouterMessage(id, req, 'admin', reponse, false);
    notifier(rec.etudiant_id, 'Réclamation traitée', `Votre réclamation ${rec.numero || ''} a été résolue.`);
    res.json({ success: true, message: 'Réponse envoyée.' });
  } catch (error) {
    console.error('[repondreReclamation]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi de la réponse.' });
  }
};

// ── PATCH /api/reclamations/:id/rejeter (admin) ─────────────────────────────
const rejeterReclamation = async (req, res) => {
  try {
    const { id } = req.params;
    const motif = (req.body.motif || '').toString().trim();
    const reponseFinale = motif || 'Réclamation rejetée par l\'administration.';
    const rec = await chargerAcces(req, id);
    if (!rec) return res.status(404).json({ success: false, message: 'Réclamation introuvable.' });
    if (rec.statut === 'resolu' || rec.statut === 'rejete') {
      return res.status(400).json({ success: false, message: 'Cette réclamation est déjà clôturée.' });
    }
    await pool.query(
      `UPDATE reclamations SET statut = 'rejete', etape = 'termine', reponse = $1, date_traitement = now() WHERE id = $2`,
      [reponseFinale, id]);
    await ajouterMessage(id, req, 'admin', reponseFinale, false);
    notifier(rec.etudiant_id, 'Réclamation traitée', `Votre réclamation ${rec.numero || ''} a été rejetée.`);
    if (rec.prof_id && rec.etape === 'professeur') notifier(rec.prof_id, 'Réclamation retirée', `${rec.numero || ''} a été clôturée par l'administration.`);
    res.json({ success: true, message: 'Réclamation rejetée.' });
  } catch (error) {
    console.error('[rejeterReclamation]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du rejet.' });
  }
};

module.exports = {
  createReclamation, autoriserPiece, verifierPiece, ajouterPiece,
  getMesReclamations, getAllReclamations, getReclamationsProfesseur, getNombreEnAttente,
  getReclamation, getProfesseursCandidats, envoyerMessage,
  transfererReclamation, retourProfesseur, repondreReclamation, rejeterReclamation,
};