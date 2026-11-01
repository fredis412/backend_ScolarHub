// Notification d'inscription : envoie à l'étudiant son matricule + le lien de
// connexion, par SMS et par Email (best-effort, ne bloque jamais l'inscription).

const { envoyerSMS } = require('./sms.service');
const { envoyerEmail } = require('./email.service');

const APP_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const lienConnexion = (matricule) =>
  `${APP_URL}/?matricule=${encodeURIComponent(matricule)}`;

/**
 * Notifie l'étudiant nouvellement inscrit.
 * @param {{prenoms:string, nom:string, matricule:string, email?:string, telephone?:string, ecole?:string, etablissementId?:number}} etu
 * @returns {Promise<{sms:{envoye:boolean,error?:string}, email:{envoye:boolean,error?:string}, lien:string}>}
 */
async function notifierInscription(etu) {
  const { prenoms, nom, matricule, email, telephone, ecole, etablissementId } = etu;
  const lien = lienConnexion(matricule);
  const filiereTxt = ecole ? ` en ${ecole}` : '';

  const resultat = {
    sms: { envoye: false },
    email: { envoye: false },
    lien,
  };

  // ─── SMS (court, ~160 caractères) ───
  if (telephone && telephone.trim()) {
    const message =
      `ScolarHub: Bonjour ${prenoms}, votre inscription${filiereTxt} est enregistree. ` +
      `Matricule: ${matricule}. Connectez-vous et definissez votre mot de passe: ${lien}`;
    try {
      const r = await envoyerSMS(telephone.trim(), message);
      resultat.sms = { envoye: !!r.success, error: r.error };
    } catch (err) {
      resultat.sms = { envoye: false, error: err.message };
    }
  }

  // ─── Email (plus riche) ───
  if (email && email.includes('@')) {
    const subject = 'Bienvenue sur ScolarHub — confirmez votre inscription';
    const text =
      `Bonjour ${prenoms} ${nom},\n\n` +
      `Votre inscription${filiereTxt} a bien été enregistrée sur ScolarHub.\n\n` +
      `Votre matricule : ${matricule}\n\n` +
      `Pour activer votre compte, cliquez sur le lien ci-dessous, saisissez votre ` +
      `matricule puis définissez votre mot de passe :\n${lien}\n\n` +
      `À bientôt,\nL'équipe ScolarHub`;
    const modele = {
      titre: 'Bienvenue sur ScolarHub',
      sousTitre: ecole ? `Inscription enregistrée · ${ecole}` : 'Inscription enregistrée',
      salutation: `Bonjour ${prenoms} ${nom},`,
      preheader: `Votre matricule : ${matricule}`,
      blocs: [
        { type: 'p', texte: `Votre inscription${filiereTxt} a bien été enregistrée sur ScolarHub.` },
        { type: 'code', label: 'Votre matricule', valeur: matricule },
        { type: 'p', texte: 'Pour activer votre compte, appuyez sur le bouton ci-dessous, saisissez votre matricule puis choisissez votre mot de passe.' },
        { type: 'bouton', label: 'Activer mon compte', url: lien },
        { type: 'note', ton: 'info', texte: 'Conservez votre matricule : il vous servira à vous connecter chaque fois.' },
      ],
    };
    try {
      const r = await envoyerEmail(email.trim(), subject, { text, modele, etablissementId });
      resultat.email = { envoye: !!r.success, error: r.error };
    } catch (err) {
      resultat.email = { envoye: false, error: err.message };
    }
  }

  return resultat;
}

module.exports = { notifierInscription, lienConnexion };