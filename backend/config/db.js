const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user:     process.env.DB_USER || process.env.user,
  host:     process.env.DB_HOST || process.env.host,
  database: process.env.DB_NAME || process.env.database,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || process.env.port) || 5432,
  ssl:      { rejectUnauthorized: false },
});

pool.on('connect', () => {
  console.log('Connected to the database');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
