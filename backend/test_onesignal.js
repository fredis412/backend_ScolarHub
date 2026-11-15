// ============================================================
// Script de test OneSignal — envoie une notification de test
// Usage: node test_onesignal.js [matricule]
// ============================================================

require('dotenv').config({ path: '../.env' });
const { envoyerNotification } = require('./src/services/onesignal.service');

const matricule = process.argv[2] || null; // passe ton matricule en argument

async function test() {
  console.log('\n🔔 Test OneSignal...');
  console.log('App ID     :', process.env.ONESIGNAL_APP_ID);
  console.log('REST Key   :', process.env.ONESIGNAL_REST_API_KEY ? '✅ configurée' : '❌ MANQUANTE');
  console.log('Destinataire:', matricule || '(tous les abonnés)');
  console.log('---');

  try {
    const result = await envoyerNotification({
      titre: '🎉 Test ScolarHub',
      message: 'Les notifications OneSignal fonctionnent correctement !',
      destinataires: matricule,          // null = broadcast à tous
      donnees: { type: 'test', source: 'test_onesignal.js' },
    });
    console.log('✅ Notification envoyée avec succès !');
    console.log('   ID OneSignal:', result?.id || result);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

test();

