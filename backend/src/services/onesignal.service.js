const https = require('https');

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '1d27fa01-4cdf-4ea7-8c47-1af912cc740b';
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';

/**
 * Envoie une notification push via OneSignal
 * @param {Object} options
 * @param {string} options.titre - Titre de la notification
 * @param {string} options.message - Corps du message
 * @param {string|string[]} [options.destinataires] - Matricule(s) ou ID(s) des utilisateurs ciblés (external_id). Si omis, envoyé à tous.
 * @param {Object} [options.donnees] - Données additionnelles JSON (ex: { type: 'note', id: 12 })
 */
async function envoyerNotification({ titre, message, destinataires = null, donnees = {} }) {
  if (!ONESIGNAL_REST_API_KEY) {
    console.warn('[OneSignal] ONESIGNAL_REST_API_KEY non configuré dans .env. Envoi ignoré.');
    return;
  }

  const payload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { fr: titre, en: titre },
    contents: { fr: message, en: message },
    data: donnees,
  };

  if (destinataires) {
    const list = (Array.isArray(destinataires) ? destinataires : [destinataires])
      .map(d => (d !== null && d !== undefined ? String(d).trim() : ''))
      .filter(Boolean);

    if (list.length === 0) {
      console.warn('[OneSignal] Aucun destinataire valide fourni. Envoi ignoré.');
      return;
    }

    payload.include_aliases = {
      external_id: list,
    };
    payload.target_channel = 'push';
  } else {
    payload.included_segments = ['Total Subscriptions'];
  }

  const dataString = JSON.stringify(payload);

  const options = {
    hostname: 'onesignal.com',
    port: 443,
    path: '/api/v1/notifications',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
      'Content-Length': Buffer.byteLength(dataString),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(responseBody);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[OneSignal] Notification envoyée avec succès:', json.id);
            resolve(json);
          } else {
            console.error('[OneSignal] Erreur retournée:', json);
            const errMsg = Array.isArray(json?.errors)
              ? json.errors.join(', ')
              : (typeof json?.errors === 'object' ? JSON.stringify(json.errors) : (json?.errors || 'Erreur OneSignal'));
            reject(new Error(errMsg));
          }
        } catch (e) {
          resolve(responseBody);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[OneSignal] Erreur réseau:', err.message);
      reject(err);
    });

    req.write(dataString);
    req.end();
  });
}

module.exports = {
  envoyerNotification,
};

