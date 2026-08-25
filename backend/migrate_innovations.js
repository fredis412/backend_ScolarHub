// Migration : tables des nouvelles fonctionnalités
// - frais_scolarite + paiements (mobile money)
// - appel_qr_sessions (appel par QR code / code de séance)
// Usage : node migrate_innovations.js

const dotenv = require('dotenv');
dotenv.config();
const pool = require('./src/config/db');

const run = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS frais_scolarite (
        id SERIAL PRIMARY KEY,
        libelle VARCHAR(255) NOT NULL,
        montant NUMERIC(12,2) NOT NULL,
        niveau VARCHAR(50),
        echeance DATE,
        actif BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Table frais_scolarite');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS paiements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        etudiant_id INTEGER REFERENCES etudiants(id) ON DELETE CASCADE,
        frais_id INTEGER REFERENCES frais_scolarite(id) ON DELETE SET NULL,
        montant NUMERIC(12,2) NOT NULL,
        operateur VARCHAR(50) NOT NULL,
        telephone VARCHAR(50),
        reference VARCHAR(100) UNIQUE,
        transaction_id VARCHAR(100),
        statut VARCHAR(50) DEFAULT 'en_attente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP
      );
    `);
    console.log('✓ Table paiements');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS appel_qr_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        appel_id UUID REFERENCES appels(id) ON DELETE CASCADE,
        code VARCHAR(10) NOT NULL,
        token UUID NOT NULL,
        statut VARCHAR(20) DEFAULT 'ouverte',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Table appel_qr_sessions');

    // Seed des frais par défaut si la table est vide
    const count = await pool.query(`SELECT COUNT(*) FROM frais_scolarite`);
    if (parseInt(count.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO frais_scolarite (libelle, montant, niveau) VALUES
        ('Frais d''inscription', 50000, NULL),
        ('Mensualité de scolarité', 25000, NULL),
        ('Frais de dossier', 10000, NULL);
      `);
      console.log('✓ Frais par défaut insérés');
    }

    console.log('Migration terminée.');
    process.exit(0);
  } catch (err) {
    console.error('Erreur migration :', err);
    process.exit(1);
  }
};

run();
