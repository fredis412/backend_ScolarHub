const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false }
});

const demoUsers = [
  {
    matricule: '24IST-ADM/001',
    nom: 'COMPAORÉ',
    prenoms: 'Idrissa',
    role: 'admin',
    domaine: '',
    password: 'admin123',
    email: 'admin@ist.bf',
    tel: null
  },
  {
    matricule: '24IST-BDE/001',
    nom: 'OUÉDRAOGO',
    prenoms: 'Aïcha',
    role: 'bde',
    domaine: '',
    password: 'bde123',
    email: 'bde@ist.bf',
    tel: null
  },
  {
    matricule: null,
    nom: 'OUÉDRAOGO',
    prenoms: 'Mamadou',
    role: 'professeur',
    domaine: 'Sciences & Technologies',
    password: 'prof123',
    email: 'mamadou.ouedraogo@ist.bf',
    tel: '70123456'
  },
  {
    matricule: null,
    nom: 'KOURAOGO',
    prenoms: 'Seydou',
    role: 'parent',
    domaine: '',
    password: 'parent123',
    email: 'parent@ist.bf',
    tel: '65001234'
  }
];

pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Error connecting:', err.stack);
    process.exit(1);
  }
  try {
    console.log('Connected to database!');
    
    // First, let's update Ibrahim's filiere_id to the 'Réseaux et Télécoms' filiere
    // Let's find the id of 'Réseaux et Télécoms'
    const filiereRes = await client.query("SELECT id FROM filieres WHERE nom ILIKE '%Réseaux%' LIMIT 1");
    if (filiereRes.rows.length > 0) {
      const filiereId = filiereRes.rows[0].id;
      await client.query("UPDATE users SET filiere_id = $1 WHERE matricule = '24IST-O2/1851'", [filiereId]);
      console.log('Updated Ibrahim filiere_id to:', filiereId);
    }
    
    // Let's insert the demo users if they don't exist
    for (const u of demoUsers) {
      // Check if user already exists
      let checkRes;
      if (u.matricule) {
        checkRes = await client.query("SELECT id FROM users WHERE matricule = $1", [u.matricule]);
      } else {
        checkRes = await client.query("SELECT id FROM users WHERE nom = $1 AND tel = $2", [u.nom, u.tel]);
      }
      
      if (checkRes.rows.length > 0) {
        console.log(`User ${u.prenoms} ${u.nom} (${u.role}) already exists.`);
        continue;
      }
      
      const hashedPass = await bcrypt.hash(u.password, 10);
      
      const insertQuery = `
        INSERT INTO users (id, matricule, nom, prenoms, role, domaine, mot_de_passe, email, tel, statut)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'actif')
      `;
      await client.query(insertQuery, [
        u.matricule,
        u.nom,
        u.prenoms,
        u.role,
        u.domaine,
        hashedPass,
        u.email,
        u.tel
      ]);
      console.log(`Inserted demo user: ${u.prenoms} ${u.nom} (${u.role})`);
    }
    
    // Print all users in users table to verify
    const allUsers = await client.query("SELECT id, nom, prenoms, matricule, role, email, tel FROM users");
    console.log('All users in DB now:', allUsers.rows);
    
  } catch (errQuery) {
    console.error('Error running query:', errQuery);
  } finally {
    release();
    pool.end();
  }
});
