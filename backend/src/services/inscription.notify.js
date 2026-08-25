// Notification d'inscription : envoie à l'étudiant son matricule + le lien de
// connexion, par SMS et par Email (best-effort, ne bloque jamais l'inscription).

const { envoyerSMS } = require('./sms.service');
const { envoyerEmail } = require('./email.service');

const APP_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');

const lienConnexion = (matricule) =>
  `${APP_URL}/?matricule=${encodeURIComponent(matricule)}`;

/**
 * Notifie l'étudiant nouvellement inscrit.
 * @param {{prenoms:string, nom:string, matricule:string, email?:string, telephone?:string, ecole?:string}} etu
 * @returns {Promise<{sms:{envoye:boolean,error?:string}, email:{envoye:boolean,error?:string}, lien:string}>}
 */
async function notifierInscription(etu) {
  const { prenoms, nom, matricule, email, telephone, ecole } = etu;
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
    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0F172A">` +
      `<h2 style="color:#1E40AF;margin-bottom:4px">Bienvenue sur ScolarHub</h2>` +
      `<p>Bonjour <b>${prenoms} ${nom}</b>,</p>` +
      `<p>Votre inscription${ecole ? ` en <b>${ecole}</b>` : ''} a bien été enregistrée.</p>` +
      `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:14px 18px;margin:18px 0">` +
      `<div style="font-size:13px;color:#64748B">Votre matricule</div>` +
      `<div style="font-size:22px;font-weight:bold;letter-spacing:1px;color:#1E40AF">${matricule}</div>` +
      `</div>` +
      `<p>Pour activer votre compte, saisissez votre matricule puis définissez votre mot de passe :</p>` +
      `<p style="text-align:center;margin:22px 0">` +
      `<a href="${lien}" style="background:#1E40AF;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;display:inline-block">Activer mon compte</a>` +
      `</p>` +
      `<p style="font-size:12px;color:#64748B">Ou copiez ce lien : <br>${lien}</p>` +
      `<p style="font-size:12px;color:#94A3B8;margin-top:24px">À bientôt,<br>L'équipe ScolarHub</p>` +
      `</div>`;
    try {
      const r = await envoyerEmail(email.trim(), subject, { text, html });
      resultat.email = { envoye: !!r.success, error: r.error };
    } catch (err) {
      resultat.email = { envoye: false, error: err.message };
    }
  }

  return resultat;
}

module.exports = { notifierInscription, lienConnexion };
