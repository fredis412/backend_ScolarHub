const pool = require('./src/config/db');

const createViews = async () => {
  try {
    await pool.query(`
      CREATE OR REPLACE VIEW vue_notes_etudiants AS 
      SELECT 
        n.id AS note_id, 
        n.etudiant_id, 
        n.valeur, 
        s.id AS session_id, 
        s.date_session, 
        s.statut AS session_statut, 
        s.is_sent, 
        m.nom AS module_nom, 
        m.coefficient, 
        u.nom AS prof_nom, 
        u.prenoms AS prof_prenoms 
      FROM notes n 
      JOIN sessions_notes s ON n.session_id = s.id 
      JOIN modules m ON s.module_id = m.id 
      LEFT JOIN users u ON s.professeur_id = u.id;
    `);

    await pool.query(`
      CREATE OR REPLACE VIEW vue_presences_etudiants AS 
      SELECT 
        p.id AS presence_id, 
        p.etudiant_id, 
        p.statut AS presence_statut, 
        a.id AS appel_id, 
        a.date_appel, 
        a.created_at, 
        a.filiere_nom, 
        a.niveau,
        m.nom AS module_nom, 
        u.nom AS prof_nom, 
        u.prenoms AS prof_prenoms 
      FROM appel_presences p 
      JOIN appels a ON p.appel_id = a.id 
      LEFT JOIN modules m ON a.module_id = m.id 
      LEFT JOIN users u ON a.professeur_id = u.id;
    `);
    
    console.log('Views created successfully');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

createViews();
