// backend/src/services/compte.notify.js
// ─────────────────────────────────────────────────────────────────────────────
// Mail de bienvenue envoyé quand un compte « Administration » ou « Professeur » est créé
// (ou quand son adresse e-mail est corrigée avant la première connexion).
// Best-effort : ne bloque jamais la création du compte et ne lève jamais d'exception.
//
// Connexion de ces comptes : l'app demande NOM + PRÉNOM + TÉLÉPHONE, puis la personne choisit
// son mot de passe à la première connexion (aucun mot de passe n'est envoyé par mail).
// ─────────────────────────────────────────────────────────────────────────────
const pool = require('../config/db');
const { envoyerEmail } = require('./email.service');

const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');

const emailValide = (e) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim()) && !/@sans-email\.scolarhub$/i.test(String(e).trim());

// Libellés des sections (identiques à l'écran « Membres » de l'app).
const SECTIONS = {
  etudiants: 'Étudiants', professeurs: 'Professeurs', filieres: 'Filières & emplois du temps', parents: 'Parents',
  notes: 'Notes & examens', bulletins: 'Bulletins', reclamations: 'Réclamations', messages: 'Messages',
  annonces: 'Annonces', publications: 'Publications', bde: 'BDE & événements', membres: 'Création de membres', stats: 'Statistiques',
};

// Rôle d'administration → libellé + mission. Tolère différentes écritures du code stocké.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const decrireRole = (code) => {
  const n = norm(code);
  if (n.includes('super')) return { label: 'Super Administrateur', mission: "Vous gérez l'ensemble de l'établissement : membres de l'administration, droits d'accès, étudiants, professeurs, filières et paramètres." };
  if (n.includes('scolar')) return { label: 'Responsable de la scolarité', mission: "Vous gérez les étudiants, les professeurs, les filières et emplois du temps, les parents et les réclamations." };
  if (n.includes('exam')) return { label: 'Responsable des examens', mission: "Vous gérez les notes, les examens, les bulletins et les réclamations liées aux évaluations." };
  if (n.includes('secret')) return { label: 'Secrétariat', mission: "Vous assurez le suivi administratif : étudiants, parents, réclamations, messages et annonces." };
  if (n.includes('communic')) return { label: 'Responsable de la communication', mission: "Vous gérez les messages, annonces, publications et la vie de l'établissement (BDE, événements)." };
  if (n.includes('cycle') || n.includes('direct')) return { label: 'Directeur de cycle', mission: "Vous supervisez les activités académiques et administratives de votre cycle." };
  if (n.includes('cantin')) return { label: 'Responsable de la cantine', mission: "Vous gérez le service de cantine de l'établissement." };
  const brut = String(code || 'Administration').replace(/_/g, ' ');
  return { label: brut.charAt(0).toUpperCase() + brut.slice(1), mission: "Vous avez un accès à l'espace d'administration, selon les autorisations ci-dessous." };
};

const blocsConnexion = ({ nom, prenoms, tel, motDePasseDefini }) => [
  { type: 'infos', lignes: [['Nom', nom], ['Prénom(s)', prenoms], ['Téléphone', tel || '—']] },
  {
    type: 'p',
    texte: motDePasseDefini
      ? "Ouvrez ScolarHub et connectez-vous avec le nom, le prénom et le téléphone ci-dessus, puis votre mot de passe."
      : "Ouvrez ScolarHub et saisissez exactement le nom, le prénom et le téléphone ci-dessus. Vous choisirez ensuite votre mot de passe lors de votre première connexion.",
  },
  ...(APP_URL ? [{ type: 'bouton', label: 'Ouvrir ScolarHub', url: APP_URL }] : []),
  { type: 'note', ton: 'alerte', texte: "Votre numéro de téléphone sert à vous identifier. S'il est incorrect, contactez l'administration pour le faire corriger." },
];

/**
 * Compte « Administration » créé.
 * @param {{nom,prenoms,email,tel,role,domaine,permissions,etablissementId,etablissementNom,motDePasseDefini}} m
 */
async function notifierMembre(m) {
  try {
    if (!emailValide(m.email)) return { envoye: false, error: 'Aucune adresse e-mail valide.' };
    const role = decrireRole(m.role);
    let perms = m.permissions || {};
    if (typeof perms === 'string') { try { perms = JSON.parse(perms); } catch (_) { perms = {}; } }
    const droits = Object.keys(SECTIONS).filter((k) => perms[k] === true).map((k) => SECTIONS[k]);
    const domaine = m.domaine && m.domaine !== 'Tous' ? m.domaine : 'Tous les domaines';
    const blocs = [
      { type: 'p', texte: `Votre compte d'administration${m.etablissementNom ? ` pour ${m.etablissementNom}` : ''} vient d'être créé sur ScolarHub.` },
      { type: 'infos', lignes: [['Rôle', role.label], ['Domaine', domaine]] },
      { type: 'p', texte: role.mission },
      ...(droits.length ? [{ type: 'infos', lignes: [['Vos autorisations', droits.join(', ')]] }] : []),
      { type: 'p', texte: 'Pour vous connecter :' },
      ...blocsConnexion({ nom: String(m.nom || '').toUpperCase(), prenoms: m.prenoms, tel: m.tel, motDePasseDefini: m.motDePasseDefini }),
    ];
    const r = await envoyerEmail(String(m.email).trim(), 'ScolarHub - Votre compte a été créé', {
      etablissementId: m.etablissementId,
      modele: {
        titre: 'Votre compte a été créé',
        sousTitre: `${role.label}${m.etablissementNom ? ` · ${m.etablissementNom}` : ''}`,
        salutation: `Bonjour ${m.prenoms} ${String(m.nom || '').toUpperCase()},`,
        preheader: `Compte ${role.label} créé : vous pouvez vous connecter.`,
        blocs,
      },
    });
    return { envoye: !!r.success, error: r.error };
  } catch (err) {
    console.error('[notifierMembre]', err.message);
    return { envoye: false, error: err.message };
  }
}

/**
 * Compte « Professeur » créé.
 * @param {{nom,prenoms,email,tel,domaines,affectations:[{filiere,niveau}],etablissementId,etablissementNom}} p
 */
async function notifierProfesseur(p) {
  try {
    if (!emailValide(p.email)) return { envoye: false, error: 'Aucune adresse e-mail valide.' };
    // Regroupe par filière : « RIT → Licence 1, Licence 3 »
    const parFiliere = new Map();
    for (const a of p.affectations || []) {
      if (!a.filiere) continue;
      if (!parFiliere.has(a.filiere)) parFiliere.set(a.filiere, []);
      if (a.niveau && !parFiliere.get(a.filiere).includes(a.niveau)) parFiliere.get(a.filiere).push(a.niveau);
    }
    const lignesAff = [...parFiliere.entries()].map(([f, n]) => [f, n.join(', ') || '—']);
    const blocs = [
      { type: 'p', texte: `Votre compte professeur${p.etablissementNom ? ` pour ${p.etablissementNom}` : ''} vient d'être créé sur ScolarHub.` },
      ...(lignesAff.length
        ? [
          { type: 'p', texte: 'Les classes qui vous sont assignées (filière et niveaux) :' },
          { type: 'infos', lignes: lignesAff },
        ]
        : [{ type: 'p', texte: "Aucune classe ne vous est encore assignée : l'administration vous les attribuera prochainement." }]),
      ...(p.domaines ? [{ type: 'infos', lignes: [['Domaine', String(p.domaines).split(',').map((x) => x.trim()).filter(Boolean).join(', ')]] }] : []),
      { type: 'p', texte: 'Sur ScolarHub, vous pourrez faire l\'appel, saisir les notes, suivre vos classes et échanger avec les étudiants. Pour vous connecter :' },
      ...blocsConnexion({ nom: String(p.nom || '').toUpperCase(), prenoms: p.prenoms, tel: p.tel, motDePasseDefini: false }),
    ];
    const r = await envoyerEmail(String(p.email).trim(), 'ScolarHub - Votre compte professeur a été créé', {
      etablissementId: p.etablissementId,
      modele: {
        titre: 'Votre compte professeur a été créé',
        sousTitre: p.etablissementNom || 'Espace professeur',
        salutation: `Bonjour ${p.prenoms} ${String(p.nom || '').toUpperCase()},`,
        preheader: 'Votre compte professeur est prêt : vous pouvez vous connecter.',
        blocs,
      },
    });
    return { envoye: !!r.success, error: r.error };
  } catch (err) {
    console.error('[notifierProfesseur]', err.message);
    return { envoye: false, error: err.message };
  }
}

// ── Chargement depuis la base + envoi (création, correction d'email, renvoi manuel) ──────────
const nomEcole = async (id) => {
  if (!id) return '';
  try { return (await pool.query('SELECT nom FROM etablissements WHERE id = $1', [id])).rows[0]?.nom || ''; } catch (_) { return ''; }
};

/** Envoie (ou renvoie) le mail de bienvenue d'un membre de l'administration. */
async function inviterMembre(userId) {
  const r = await pool.query(
    `SELECT u.id, u.nom, u.prenoms, u.email, u.tel, u.admin_sub_role, u.statut, u.etablissement_id,
            (u.mot_de_passe IS NOT NULL) AS a_mdp, m.permissions
     FROM users u LEFT JOIN membres m ON m.user_id = u.id
     WHERE u.id = $1 AND u.role = 'admin'`, [userId]);
  const u = r.rows[0];
  if (!u) return { envoye: false, raison: 'introuvable', error: 'Membre introuvable.' };
  if (!emailValide(u.email)) return { envoye: false, raison: 'aucun_email', error: "Ce membre n'a pas d'adresse e-mail valide." };
  let perms = u.permissions || {};
  if (typeof perms === 'string') { try { perms = JSON.parse(perms); } catch (_) { perms = {}; } }
  return notifierMembre({
    nom: u.nom, prenoms: u.prenoms, email: u.email, tel: u.tel, role: u.admin_sub_role,
    domaine: perms.domaine, permissions: perms, etablissementId: u.etablissement_id,
    etablissementNom: await nomEcole(u.etablissement_id), motDePasseDefini: !!u.a_mdp,
  });
}

/** Envoie (ou renvoie) le mail de bienvenue d'un professeur, avec ses filières et niveaux. */
async function inviterProfesseur(userId) {
  const r = await pool.query(
    `SELECT id, nom, prenoms, email, tel, domaine, statut, etablissement_id FROM users WHERE id = $1 AND role = 'professeur'`, [userId]);
  const u = r.rows[0];
  if (!u) return { envoye: false, raison: 'introuvable', error: 'Professeur introuvable.' };
  if (!emailValide(u.email)) return { envoye: false, raison: 'aucun_email', error: "Ce professeur n'a pas d'adresse e-mail valide." };
  let aff = [];
  try {
    aff = (await pool.query(
      `SELECT f.nom AS filiere, pf.niveau FROM professeur_filieres pf
       JOIN filieres f ON f.id = pf.filiere_id WHERE pf.professeur_id = $1 ORDER BY f.nom, pf.niveau`, [userId])).rows;
  } catch (e) { console.error('[inviterProfesseur] affectations:', e.message); }
  return notifierProfesseur({
    nom: u.nom, prenoms: u.prenoms, email: u.email, tel: u.tel, domaines: u.domaine, affectations: aff,
    etablissementId: u.etablissement_id, etablissementNom: await nomEcole(u.etablissement_id),
  });
}

/** Le compte a-t-il déjà un mot de passe (= déjà activé) ? */
const compteActive = async (userId) => {
  try { return !!(await pool.query('SELECT 1 FROM users WHERE id = $1 AND mot_de_passe IS NOT NULL', [userId])).rows[0]; } catch (_) { return false; }
};

module.exports = { notifierMembre, notifierProfesseur, inviterMembre, inviterProfesseur, compteActive, decrireRole, emailValide };
