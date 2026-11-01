// Service Email — abstraction fournisseur (miroir de sms.service.js).
// EMAIL_PROVIDER=console (défaut, dev) | smtp | brevo | sendgrid
//
// - console : journalise l'email (dev / démo, aucune config requise).
// - smtp    : nodemailer + SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.
// - brevo   : API HTTP Brevo (Sendinblue) via BREVO_API_KEY — aucune dépendance.
// - sendgrid: API HTTP SendGrid via SENDGRID_API_KEY — aucune dépendance.
//
// Ne lève jamais d'exception : retourne toujours { success, error? }.

const PROVIDER = process.env.EMAIL_PROVIDER || 'console';
const FROM_EMAIL = process.env.EMAIL_FROM || 'no-reply@scolarhub.bf';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'ScolarHub';

// Un seul expéditeur technique pour toute l'application (EMAIL_FROM). Le NOM affiché est
// celui de l'école (« IST Ouaga 2000 via ScolarHub ») et les réponses vont à l'adresse de
// l'école (etablissements.email_contact) : voir contenu.etablissementId plus bas.
const nettoyerNom = (n) => String(n || '').replace(/["<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// ── Habillage des mails : logo ScolarHub + logo de l'établissement ──────────────────────
// Le logo ScolarHub doit être joignable publiquement : EMAIL_LOGO_URL (ex. lien Cloudinary),
// sinon l'icône du site (APP_URL/icons/Icon-192.png).
const echapper = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const logoScolarHub = () => {
  if (process.env.EMAIL_LOGO_URL) return process.env.EMAIL_LOGO_URL;
  const app = (process.env.APP_URL || '').replace(/\/+$/, '');
  return app ? `${app}/icons/Icon-192.png` : '';
};

const enteteMarque = (ecole) => {
  const sh = logoScolarHub();
  const imgSh = sh
    ? `<img src="${echapper(sh)}" alt="ScolarHub" width="48" height="48" style="display:block;border-radius:10px;border:0">`
    : '';
  const logoEcole = ecole && /^https?:\/\//i.test(ecole.logo_url || '') ? ecole.logo_url : '';
  const imgEcole = logoEcole
    ? `<img src="${echapper(logoEcole)}" alt="${echapper(ecole.nom)}" height="48" style="display:block;max-height:48px;max-width:140px;border:0">`
    : '';
  if (!imgSh && !imgEcole) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-sh-brand="1" style="max-width:600px;margin:0 auto 12px;border-bottom:2px solid #F8C400"><tr>`
    + `<td align="left" style="padding:10px 0">${imgSh}</td>`
    + `<td align="right" style="padding:10px 0">${imgEcole}</td></tr></table>`;
};

const habillerHtml = (html, text, ecole) => {
  const corps = html || `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0F172A;max-width:600px;margin:0 auto;white-space:pre-wrap">${echapper(text)}</div>`;
  if (corps.includes('data-sh-brand')) return corps;
  const entete = enteteMarque(ecole);
  if (!entete) return corps;
  if (/<body[^>]*>/i.test(corps)) return corps.replace(/(<body[^>]*>)/i, `$1${entete}`);
  return `<div style="font-family:Arial,sans-serif">${entete}${corps}</div>`;
};

// ── Gabarit professionnel des mails ────────────────────────────────────────────────────
// Un seul modèle pour TOUS les mails : en-tête (logos), bandeau titre, contenu, pied de page.
// Deux façons de l'utiliser :
//   1) Mail « texte » (comme avant) : le texte est mis en forme automatiquement
//      (salutation, code mis en valeur, liens en bouton, rappels en encadré).
//   2) Mail « structuré » : envoyerEmail(to, objet, { modele: { titre, sousTitre, salutation, blocs } })
//      blocs : { type:'p', texte } | { type:'code', label, valeur } | { type:'infos', lignes:[[libellé, valeur]] }
//              | { type:'bouton', label, url } | { type:'note', texte, ton:'info'|'alerte' }
const C = {
  bleu: '#0A4DA2', bleuFonce: '#073B7D', jaune: '#F8C400', texte: '#0F172A', doux: '#475569',
  pale: '#94A3B8', fond: '#EEF2F7', filet: '#E2E8F0', zone: '#EFF6FF', zoneBord: '#93C5FD',
};
const POLICE = "Segoe UI,Helvetica,Arial,sans-serif";
const lier = (t) =>
  echapper(t)
    .replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${C.bleu};text-decoration:underline;word-break:break-all">${u}</a>`)
    .replace(/\n/g, '<br>');

const bloc = {
  p: (b) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${C.texte}">${lier(b.texte)}</p>`,
  code: (b) => {
    const valeur = String(b.valeur);
    const numerique = /^\d+$/.test(valeur);       // code à chiffres : police à chasse fixe
    const long = valeur.length > 10 || !numerique; // matricule : police normale (on distingue bien « O » et « 0 »)
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr>`
      + `<td align="center" style="background:${C.zone};border:2px dashed ${C.zoneBord};border-radius:14px;padding:20px 12px">`
      + `<div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${C.doux};font-weight:bold;margin-bottom:10px">${echapper(b.label)}</div>`
      + `<div style="font-family:${numerique ? "'Courier New',Consolas,monospace" : 'Arial,Helvetica,sans-serif'};font-size:${long ? 26 : 36}px;font-weight:bold;letter-spacing:${long ? 2 : 7}px;color:${C.bleu};`
      + `user-select:all;-webkit-user-select:all;-moz-user-select:all">${echapper(b.valeur)}</div>`
      + `<div style="font-size:12px;color:${C.pale};margin-top:10px">Appuyez sur le code pour le sélectionner d'un coup, puis copiez-le.</div>`
      + `</td></tr></table>`;
  },
  infos: (b) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border:1px solid ${C.filet};border-radius:12px;border-collapse:separate;overflow:hidden">`
    + (b.lignes || []).map(([k, v], i) =>
      `<tr><td style="padding:11px 14px;font-size:13px;color:${C.doux};background:#F8FAFC;width:38%;${i ? `border-top:1px solid ${C.filet};` : ''}">${echapper(k)}</td>`
      + `<td style="padding:11px 14px;font-size:14px;font-weight:bold;color:${C.texte};${i ? `border-top:1px solid ${C.filet};` : ''}">${echapper(v)}</td></tr>`).join('')
    + `</table>`,
  bouton: (b) =>
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:10px auto 6px"><tr>`
    + `<td align="center" bgcolor="${C.bleu}" style="border-radius:10px;background:${C.bleu}">`
    + `<a href="${echapper(b.url)}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:10px">${echapper(b.label)}</a>`
    + `</td></tr></table>`
    + `<p style="margin:10px 0 20px;font-size:12px;line-height:1.5;color:${C.pale};text-align:center;word-break:break-all">Si le bouton ne s'ouvre pas, copiez ce lien dans votre navigateur :<br>`
    + `<a href="${echapper(b.url)}" style="color:${C.bleu}">${echapper(b.url)}</a></p>`,
  note: (b) => {
    const alerte = b.ton !== 'info';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr>`
      + `<td style="background:${alerte ? '#FFF7E6' : '#F8FAFC'};border-left:4px solid ${alerte ? C.jaune : C.zoneBord};border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.55;color:${alerte ? '#7A5A12' : C.doux}">${lier(b.texte)}</td></tr></table>`;
  },
};

const enteteCarte = (ecole) => {
  const sh = logoScolarHub();
  const imgSh = sh ? `<img src="${echapper(sh)}" alt="ScolarHub" width="48" height="48" style="display:block;border-radius:10px;border:0">` : '';
  const logoEcole = ecole && /^https?:\/\//i.test(ecole.logo_url || '') ? ecole.logo_url : '';
  const imgEcole = logoEcole ? `<img src="${echapper(logoEcole)}" alt="${echapper(ecole.nom)}" height="48" style="display:block;max-height:48px;max-width:150px;border:0">` : '';
  if (!imgSh && !imgEcole) return '';
  return `<tr><td style="padding:18px 28px;border-bottom:3px solid ${C.jaune}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
    + `<td align="left">${imgSh}</td><td align="right">${imgEcole}</td></tr></table></td></tr>`;
};

const construireMail = ({ titre, sousTitre, salutation, blocs = [], ecole, preheader, signature = true }) => {
  const nomEcole = ecole && ecole.nom ? ecole.nom : '';
  const corps = blocs.filter((b) => bloc[b.type]).map((b) => bloc[b.type](b)).join('');
  const annee = new Date().getFullYear();
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="color-scheme" content="light"><title>${echapper(titre || 'ScolarHub')}</title></head>`
    + `<body style="margin:0;padding:0;background:${C.fond};font-family:${POLICE}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.fond}">${echapper(preheader || titre || '')}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.fond}" style="background:${C.fond}"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-sh-brand="1" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid ${C.filet}">`
    + enteteCarte(ecole)
    + `<tr><td bgcolor="${C.bleu}" style="background:${C.bleu};background-image:linear-gradient(135deg,${C.bleu},${C.bleuFonce});padding:26px 28px">`
    + `<div style="font-size:23px;line-height:1.3;font-weight:bold;color:#FFFFFF">${echapper(titre || '')}</div>`
    + (sousTitre ? `<div style="font-size:14px;color:#DBEAFE;margin-top:6px">${echapper(sousTitre)}</div>` : '')
    + `</td></tr>`
    + `<tr><td style="padding:28px 28px 8px;font-family:${POLICE}">`
    + (salutation ? `<p style="margin:0 0 16px;font-size:17px;font-weight:bold;color:${C.texte}">${echapper(salutation)}</p>` : '')
    + corps
    + (signature ? `<p style="margin:8px 0 20px;font-size:14px;line-height:1.6;color:${C.doux}">Cordialement,<br><b style="color:${C.texte}">L'équipe ScolarHub</b>${nomEcole ? `<br><span style="color:${C.pale}">${echapper(nomEcole)}</span>` : ''}</p>` : '')
    + `</td></tr>`
    + `<tr><td style="background:#F8FAFC;border-top:1px solid ${C.filet};padding:18px 28px;font-size:12px;line-height:1.6;color:${C.pale};text-align:center">`
    + `Ce message a été envoyé automatiquement par ScolarHub${nomEcole ? ` pour ${echapper(nomEcole)}` : ''}.<br>`
    + `Si vous n'êtes pas concerné(e), vous pouvez l'ignorer en toute sécurité.<br>© ${annee} ScolarHub`
    + `</td></tr></table></td></tr></table></body></html>`;
};

const titreDepuisObjet = (objet) => String(objet || 'ScolarHub').replace(/^\s*ScolarHub\s*[-—–:]\s*/i, '').trim() || 'ScolarHub';

// Transforme un mail « texte » en blocs mis en forme (aucun changement à faire chez l'appelant).
const MOTS_CODE = /(code|matricule|mot de passe|identifiant|numéro|numero|référence|reference|pin|otp)/i;
const textVersBlocs = (text) => {
  const paras = String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let salutation = '';
  const blocs = [];
  paras.forEach((p, i) => {
    if (i === 0 && /^(bonjour|bonsoir|cher|chère|madame|monsieur)/i.test(p) && p.length < 120 && !p.includes('\n')) { salutation = p; return; }
    if (/^(l['’]équipe|à bientôt|cordialement|bien cordialement)/i.test(p) && p.length < 80) return; // la signature est ajoutée par le gabarit
    if (/^https?:\/\/\S+$/.test(p)) { blocs.push({ type: 'bouton', label: 'Ouvrir le lien', url: p }); return; }
    const m = p.match(/^(.{3,90}?)\s*:\s*([A-Za-z0-9][A-Za-z0-9\-\/_.]{3,30})\s*\.?$/);
    if (m && /\d/.test(m[2]) && MOTS_CODE.test(m[1])) {
      blocs.push({ type: 'code', label: m[1].replace(/\s+est$/i, ''), valeur: m[2] });
      return;
    }
    const lignes = p.split('\n').map((l) => l.match(/^([^:]{2,40}?)\s*:\s*(.{1,120})$/));
    if (p.includes('\n') && lignes.every(Boolean)) { blocs.push({ type: 'infos', lignes: lignes.map((x) => [x[1], x[2]]) }); return; }
    if (/^(ce code expire|si vous n['’]êtes pas|attention|important)/i.test(p)) { blocs.push({ type: 'note', texte: p, ton: 'alerte' }); return; }
    blocs.push({ type: 'p', texte: p });
  });
  return { salutation, blocs };
};

const blocsVersTexte = (m) =>
  [m.salutation, ...(m.blocs || []).map((b) => {
    if (b.type === 'code') return `${b.label} : ${b.valeur}`;
    if (b.type === 'infos') return (b.lignes || []).map(([k, v]) => `${k} : ${v}`).join('\n');
    if (b.type === 'bouton') return `${b.label} : ${b.url}`;
    return b.texte || '';
  }), "Cordialement,\nL'équipe ScolarHub"].filter(Boolean).join('\n\n');

// Fournisseur "console" : journalise l'email (dev / démo).
const consoleProvider = {
  async envoyer(to, subject, { text }) {
    console.log(`[EMAIL → ${to}] ${subject}\n${text}`);
    return { success: true, provider: 'console' };
  },
};

// SMTP via nodemailer (chargé à la demande : dépendance requise seulement ici).
const smtpProvider = {
  async envoyer(to, subject, { text, html, fromName, replyTo }) {
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
        connectionTimeout: 10000, // ne pas bloquer la requête si le port SMTP est filtré
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      await transport.sendMail({
        from: `"${fromName || FROM_NAME}" <${FROM_EMAIL}>`,
        to,
        subject,
        text,
        html,
        ...(replyTo ? { replyTo } : {}),
      });
      return { success: true, provider: 'smtp' };
    } catch (err) {
      console.error('[EMAIL SMTP]', err.message);
      return { success: false, error: err.message };
    }
  },
};

// Brevo (ex-Sendinblue) — API HTTP, aucune dépendance npm.
const brevoProvider = {
  async envoyer(to, subject, { text, html, fromName, replyTo }) {
    const key = process.env.BREVO_API_KEY;
    if (!key) return { success: false, error: 'BREVO_API_KEY non configuré.' };
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify({
          sender: { name: fromName || FROM_NAME, email: FROM_EMAIL },
          ...(replyTo ? { replyTo: { email: replyTo } } : {}),
          to: [{ email: to }],
          subject,
          htmlContent: html || `<pre>${text}</pre>`,
          textContent: text,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.error('[EMAIL Brevo]', response.status, body);
        return { success: false, error: `Brevo API ${response.status}` };
      }
      return { success: true, provider: 'brevo' };
    } catch (err) {
      console.error('[EMAIL Brevo]', err.message);
      return { success: false, error: err.message };
    }
  },
};

// SendGrid — API HTTP, aucune dépendance npm.
const sendgridProvider = {
  async envoyer(to, subject, { text, html, fromName, replyTo }) {
    const key = process.env.SENDGRID_API_KEY;
    if (!key) return { success: false, error: 'SENDGRID_API_KEY non configuré.' };
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: FROM_EMAIL, name: fromName || FROM_NAME },
          ...(replyTo ? { reply_to: { email: replyTo } } : {}),
          subject,
          content: [
            { type: 'text/plain', value: text },
            ...(html ? [{ type: 'text/html', value: html }] : []),
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.error('[EMAIL SendGrid]', response.status, body);
        return { success: false, error: `SendGrid API ${response.status}` };
      }
      return { success: true, provider: 'sendgrid' };
    } catch (err) {
      console.error('[EMAIL SendGrid]', err.message);
      return { success: false, error: err.message };
    }
  },
};

const providers = {
  console: consoleProvider,
  smtp: smtpProvider,
  brevo: brevoProvider,
  sendgrid: sendgridProvider,
};

/**
 * Envoie un email. Ne lève jamais d'exception.
 * @param {string} to - adresse du destinataire
 * @param {string} subject - objet
 * @param {{text:string, html?:string, etablissementId?:number, fromName?:string, replyTo?:string}} contenu
 *   etablissementId : l'expéditeur affiché devient « <École> via ScolarHub » et les réponses
 *   vont à l'email de l'école (etablissements.email_contact), s'il est renseigné.
 * @returns {Promise<{success:boolean, provider?:string, error?:string}>}
 */
const envoyerEmail = async (to, subject, contenu = {}) => {
  if (!to || !to.includes('@') || /@sans-email\.scolarhub$/i.test(to.trim())) {
    return { success: false, error: 'Adresse email invalide ou absente.' };
  }
  const { etablissementId, modele, ...reste } = contenu;
  let ecole = null;
  if (etablissementId && !reste.fromName) {
    try {
      const pool = require('../config/db'); // chargé à la demande : pas de cycle au démarrage
      const r = await pool.query('SELECT nom, email_contact, logo_url FROM etablissements WHERE id = $1', [etablissementId]);
      const e = r.rows[0];
      if (e) {
        ecole = e;
        const nom = nettoyerNom(e.nom);
        if (nom) reste.fromName = `${nom} via ScolarHub`;
        if (!reste.replyTo && e.email_contact && e.email_contact.includes('@')) reste.replyTo = e.email_contact.trim();
      }
    } catch (err) {
      console.error('[EMAIL] expéditeur par établissement indisponible :', err.message); // ex. migration non faite
    }
  }
  try {
    if (modele) {
      // Mail structuré : gabarit complet.
      reste.html = construireMail({ titre: titreDepuisObjet(subject), ...modele, ecole });
      if (!reste.text) reste.text = blocsVersTexte(modele);
    } else if (!reste.html && reste.text) {
      // Mail « texte » : mis en forme automatiquement.
      reste.html = construireMail({ titre: titreDepuisObjet(subject), ...textVersBlocs(reste.text), ecole });
    } else if (PROVIDER !== 'console') {
      reste.html = habillerHtml(reste.html, reste.text, ecole); // ancien format : simple en-tête de logos
    }
  } catch (err) {
    console.error('[EMAIL] habillage indisponible :', err.message);
  }
  const provider = providers[PROVIDER] || consoleProvider;
  return provider.envoyer(to.trim(), subject, reste);
};

module.exports = { envoyerEmail, envoyer: envoyerEmail, construireMail, textVersBlocs, titreDepuisObjet };