// Service SMS — abstraction fournisseur.
// SMS_PROVIDER=console (défaut, dev) | orange | twilio
// Permet de notifier les parents sans smartphone (absences, alertes, paiements).

const PROVIDER = process.env.SMS_PROVIDER || 'console';

// Fournisseur "console" : journalise le SMS (dev / démo).
const consoleProvider = {
  async envoyer(tel, message) {
    console.log(`[SMS → ${tel}] ${message}`);
    return { success: true, provider: 'console' };
  },
};

// Orange SMS API (Burkina Faso / Afrique de l'Ouest).
// Requiert ORANGE_SMS_TOKEN et ORANGE_SMS_SENDER dans .env
const orangeProvider = {
  async envoyer(tel, message) {
    const token = process.env.ORANGE_SMS_TOKEN;
    const sender = process.env.ORANGE_SMS_SENDER || 'ScolarHub';
    if (!token) return { success: false, error: 'ORANGE_SMS_TOKEN non configuré.' };
    try {
      const dest = tel.startsWith('+') ? tel : `+226${tel.replace(/\s/g, '')}`;
      const response = await fetch(
        `https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B226${encodeURIComponent(sender)}/requests`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            outboundSMSMessageRequest: {
              address: `tel:${dest}`,
              senderAddress: `tel:+226${sender}`,
              outboundSMSTextMessage: { message },
            },
          }),
        },
      );
      if (!response.ok) {
        const body = await response.text();
        console.error('[SMS Orange]', response.status, body);
        return { success: false, error: `Orange SMS API ${response.status}` };
      }
      return { success: true, provider: 'orange' };
    } catch (err) {
      console.error('[SMS Orange]', err);
      return { success: false, error: err.message };
    }
  },
};

const providers = { console: consoleProvider, orange: orangeProvider };

/**
 * Envoie un SMS. Ne lève jamais d'exception : retourne { success, error? }.
 * @param {string} tel - numéro du destinataire
 * @param {string} message - contenu (160 caractères recommandés)
 */
const envoyerSMS = async (tel, message) => {
  if (!tel || !tel.trim()) return { success: false, error: 'Numéro manquant.' };
  const provider = providers[PROVIDER] || consoleProvider;
  return provider.envoyer(tel.trim(), message);
};

module.exports = { envoyerSMS };
