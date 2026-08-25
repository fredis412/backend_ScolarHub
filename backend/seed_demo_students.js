// Seed des étudiants de démonstration (matricules utilisés dans l'app).
// Idempotent : n'insère que les comptes absents.
//   node seed_demo_students.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/config/db');

const demos = [
  {
    matricule: '24IST-O2/1851',
    nom: 'KOURAOGO', prenoms: 'Ibrahim',
    filiere: 'Réseaux Informatiques et Télécom',
    domaine: 'Sciences & Technologies', niveau: 'Licence 2',
    email: 'ibrahim.kouraogo@ist.bf', tel: '70000018',
    password: '1851', // mot de passe déjà défini
  },
  {
    matricule: '24IST-O2/1234',
    nom: 'TRAORÉ', prenoms: 'Fatimata',
    filiere: 'Licence Informatique',
    domaine: 'Sciences & Technologies', niveau: 'Licence 2',
    email: null, tel: '70000012',
    password: null, // première connexion (définira son mot de passe)
  },
  {
    matricule: '23IST-O2/0987',
    nom: 'SAWADOGO', prenoms: 'Moussa',
    filiere: 'Gestion Comptable et Financière',
    domaine: 'Sciences de Gestion', niveau: 'Licence 3',
    email: 'moussa.sawadogo@ist.bf', tel: '70000009',
    password: '0987',
  },
];

(async () => {
  const client = await pool.connect();
  try {
    for (const d of demos) {
      const exists = await client.query('SELECT id FROM users WHERE matricule = $1', [d.matricule]);
      if (exists.rows.length > 0) {
        console.log(`= déjà présent : ${d.matricule} (${d.prenoms} ${d.nom})`);
        continue;
      }
      await client.query('BEGIN');

      const fRes = await client.query('SELECT id FROM filieres WHERE nom ILIKE $1 LIMIT 1', [`%${d.filiere.split(' ')[0]}%`]);
      const filiereId = fRes.rows[0]?.id || null;
      const hashed = d.password ? await bcrypt.hash(d.password, 10) : null;

      const uRes = await client.query(
        `INSERT INTO users (matricule, nom, prenoms, email, tel, role, statut, mot_de_passe, domaine, niveau, filiere_nom)
         VALUES ($1,$2,$3,$4,$5,'etudiant','actif',$6,$7,$8,$9) RETURNING id`,
        [d.matricule, d.nom, d.prenoms, d.email, d.tel, hashed, d.domaine, d.niveau, d.filiere]
      );
      const userId = uRes.rows[0].id;

      await client.query(
        `INSERT INTO etudiants (user_id, filiere_id, premierefois, matricule, nom, prenoms, email, tel, filiere_nom, domaine, niveau, nationalite, statut)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Burkinabè','actif')`,
        [userId, filiereId, d.password ? false : true, d.matricule, d.nom, d.prenoms, d.email, d.tel, d.filiere, d.domaine, d.niveau]
      );

      await client.query('COMMIT');
      console.log(`+ créé : ${d.matricule} (${d.prenoms} ${d.nom})${d.password ? ' [mdp: ' + d.password + ']' : ' [1ère connexion]'}`);
    }
    console.log('Terminé.');
    process.exit(0);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Erreur seed:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
})();
