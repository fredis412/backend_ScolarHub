const pool = require('./src/config/db');
pool.query("SELECT id, nom, prenoms, role, admin_sub_role, tel FROM users WHERE nom ILIKE '%lankoande%'")
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(() => process.exit(0));
