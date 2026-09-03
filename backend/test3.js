const pool = require('./src/config/db');
async function run() {
  try {
    const r = await pool.query("SELECT id, nom, prenoms, role, admin_sub_role, tel FROM users WHERE nom ILIKE '%lankoande%'");
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
run();
