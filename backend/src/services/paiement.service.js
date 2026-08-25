// Service de paiement mobile money — abstraction agrégateur.
// PAYMENT_PROVIDER=mock (défaut, dev/démo) | cinetpay
// Opérateurs supportés : orange_money | wave | moov_money | mtn_momo

const crypto = require('crypto');

const PROVIDER = process.env.PAYMENT_PROVIDER || 'mock';

const OPERATEURS = ['orange_money', 'wave', 'moov_money', 'mtn_momo'];

// ── Fournisseur "mock" : simule le flux OTP complet (démo / dev) ──
// initier → génère un OTP journalisé ; confirmer → vérifie l'OTP.
const otpStore = new Map(); // reference -> { code, expires }

const mockProvider = {
  async initier({ montant, telephone, operateur }) {
    const reference = 'SH-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(reference, { code, expires: Date.now() + 5 * 60 * 1000 });
    // En mode mock, le "SMS" de l'OTP part dans les logs serveur.
    console.log(`[Paiement mock] OTP pour ${reference} (${operateur}, ${telephone}, ${montant} FCFA) : ${code}`);
    return { success: true, reference, otp_requis: true };
  },

  async confirmer({ reference, code }) {
    const entry = otpStore.get(reference);
    if (!entry) return { success: false, error: 'Référence inconnue ou expirée.' };
    if (Date.now() > entry.expires) {
      otpStore.delete(reference);
      return { success: false, error: 'Code expiré. Relancez le paiement.' };
    }
    // En mock, on accepte l'OTP généré, ou 123456 pour faciliter les démos.
    if (code !== entry.code && code !== '123456') {
      return { success: false, error: 'Code incorrect.' };
    }
    otpStore.delete(reference);
    return { success: true, transaction_id: 'TXN-' + Date.now() };
  },
};

// ── CinetPay (agrégateur Orange/Wave/Moov/MTN en Afrique de l'Ouest) ──
// Requiert CINETPAY_API_KEY et CINETPAY_SITE_ID dans .env
const cinetpayProvider = {
  async initier({ montant, telephone, operateur, description }) {
    const apiKey = process.env.CINETPAY_API_KEY;
    const siteId = process.env.CINETPAY_SITE_ID;
    if (!apiKey || !siteId) {
      return { success: false, error: 'CINETPAY_API_KEY / CINETPAY_SITE_ID non configurés.' };
    }
    try {
      const reference = 'SH-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const response = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: apiKey,
          site_id: siteId,
          transaction_id: reference,
          amount: montant,
          currency: 'XOF',
          description: description || 'Frais de scolarité ScolarHub',
          customer_phone_number: telephone,
          channels: 'MOBILE_MONEY',
        }),
      });
      const data = await response.json();
      if (data.code !== '201') {
        return { success: false, error: data.message || 'Erreur CinetPay.' };
      }
      return {
        success: true,
        reference,
        otp_requis: false,
        payment_url: data.data && data.data.payment_url,
      };
    } catch (err) {
      console.error('[CinetPay initier]', err);
      return { success: false, error: err.message };
    }
  },

  async confirmer({ reference }) {
    const apiKey = process.env.CINETPAY_API_KEY;
    const siteId = process.env.CINETPAY_SITE_ID;
    try {
      const response = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: apiKey, site_id: siteId, transaction_id: reference }),
      });
      const data = await response.json();
      if (data.code === '00' && data.data && data.data.status === 'ACCEPTED') {
        return { success: true, transaction_id: data.data.operator_id || reference };
      }
      return { success: false, error: 'Paiement non confirmé par l\'opérateur.' };
    } catch (err) {
      console.error('[CinetPay confirmer]', err);
      return { success: false, error: err.message };
    }
  },
};

const providers = { mock: mockProvider, cinetpay: cinetpayProvider };

const getProvider = () => providers[PROVIDER] || mockProvider;

module.exports = { getProvider, OPERATEURS };
