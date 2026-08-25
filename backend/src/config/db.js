const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  host:     process.env.DB_HOST || process.env.host,
  port:     parseInt(process.env.DB_PORT || process.env.port) || 5432,
  database: process.env.DB_NAME || process.env.database,
  user:     process.env.DB_USER || process.env.user,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  ssl:      { rejectUnauthorized: false },
  keepAlive: true,
  // Le pooler Supabase coupe les connexions inactives : on les recycle avant.
  idleTimeoutMillis: 30000,
});
// Test de connexion via pool.query : contrairement à pool.connect(cb) sans
// release, aucun client ne reste réservé (un client orphelin dont la
// connexion est coupée par le pooler ferait crasher le process).
pool.query('SELECT 1')
  .then(() => console.log('Connecte a PostgreSQL — scolarhub'))
  .catch((err) => console.error('Erreur connexion PostgreSQL :', err.message, '(' + err.code + ')'));
pool.on('error', (err, client) => {
  console.error('Erreur inattendue sur le client PostgreSQL idle', err);
});

module.exports = pool;
