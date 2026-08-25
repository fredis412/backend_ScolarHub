const bcrypt = require('bcryptjs');
const pool = require('./src/config/db');

async function run() {
  const h = await bcrypt.hash('admin123', 10);
  await pool.query('UPDATE users SET mot_de_passe = $1 WHERE role = $2', [h, 'admin']);
  console.log('Password updated');
  process.exit(0);
}
run();
