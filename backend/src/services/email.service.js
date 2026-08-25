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

// Fournisseur "console" : journalise l'email (dev / démo).
const consoleProvider = {
  async envoyer(to, subject, { text }) {
    console.log(`[EMAIL → ${to}] ${subject}\n${text}`);
    return { success: true, provider: 'console' };
  },
};

// SMTP via nodemailer (chargé à la demande : dépendance requise seulement ici).
const smtpProvider = {
  async envoyer(to, subject, { text, html }) {
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transport.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to,
        subject,
        text,
        html,
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
  async envoyer(to, subject, { text, html }) {
    const key = process.env.BREVO_API_KEY;
    if (!key) return { success: false, error: 'BREVO_API_KEY non configuré.' };
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify({
          sender: { name: FROM_NAME, email: FROM_EMAIL },
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
  async envoyer(to, subject, { text, html }) {
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
          from: { email: FROM_EMAIL, name: FROM_NAME },
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
 * @param {{text:string, html?:string}} contenu
 * @returns {Promise<{success:boolean, provider?:string, error?:string}>}
 */
const envoyerEmail = async (to, subject, contenu) => {
  if (!to || !to.includes('@')) {
    return { success: false, error: 'Adresse email invalide ou absente.' };
  }
  const provider = providers[PROVIDER] || consoleProvider;
  return provider.envoyer(to, subject, contenu);
};

module.exports = { envoyerEmail, envoyer: envoyerEmail };
