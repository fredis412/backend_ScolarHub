const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const client = await pool.connect();
    console.log('--- CONNEXION REUSSIE A SUPABASE ---');

    // 1. Compter les utilisateurs par rôle
    const rolesRes = await client.query('SELECT role, COUNT(*)::int AS count FROM users GROUP BY role');
    console.log('\nUtilisateurs par rôle dans la table "users" :');
    console.log(rolesRes.rows);

    // 2. Compter les lignes de la table etudiants
    const etuCountRes = await client.query('SELECT COUNT(*)::int AS count FROM etudiants');
    console.log('\nNombre de lignes dans la table "etudiants" :', etuCountRes.rows[0].count);

    // 3. Tester la relation inner join
    const testQuery = await client.query(`
      SELECT
        e.id AS etudiant_id,
        u.nom,
        u.prenoms,
        u.role
      FROM etudiants e
      INNER JOIN users u ON u.id = e.user_id
    `);
    console.log('\nNombre d\'étudiants retournés par INNER JOIN etudiants/users :', testQuery.rows.length);
    if (testQuery.rows.length > 0) {
      console.log('Exemple d\'étudiant trouvé :', testQuery.rows[0]);
    }

    client.release();
  } catch (err) {
    console.error('ERREUR LORS DU TEST :', err);
  } finally {
    await pool.end();
  }
})();
