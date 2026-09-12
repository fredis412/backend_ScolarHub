const pool = require('../config/db');

const getAdminDashboard = async (req, res) => {
  try {
    // 1. Fetch KPI counts
    const kpisResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'etudiant' AND statut = 'actif') as etudiants_actifs,
        (SELECT COUNT(*) FROM users WHERE role = 'professeur' AND statut = 'actif') as professeurs_actifs,
        (SELECT COUNT(*) FROM filieres) as filieres_ouvertes,
        (SELECT COUNT(*) FROM evenements_inscriptions) as tickets_vendus
    `);
    const kpis = kpisResult.rows[0] || {};

    // 2. Fetch Recent Reclamations (limit 5)
    const reclamationsResult = await pool.query(`
      SELECT r.*, u.nom, u.prenoms, m.nom AS module_nom
      FROM reclamations r
      JOIN users u ON u.id = r.etudiant_id
      LEFT JOIN modules m ON m.id::text = r.module_id::text
      ORDER BY r.created_at DESC
      LIMIT 5
    `);

    // 3. Fetch Upcoming Events (limit 3)
    const eventsResult = await pool.query(`
      SELECT * FROM evenements 
      WHERE date_debut >= NOW() 
      ORDER BY date_debut ASC 
      LIMIT 3
    `);

    // 4. Fetch Alerts (Pending reclamations, pending bde posts, suspend students)
    const alertsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM reclamations WHERE statut = 'en_attente') as reclamations_attente,
        (SELECT COUNT(*) FROM annonces WHERE statut = 'en_attente') as publications_attente,
        (SELECT COUNT(*) FROM users WHERE role = 'etudiant' AND statut = 'suspendu') as etudiants_suspendus
    `);
    const alerts = alertsResult.rows[0] || {};

    res.json({
      success: true,
      data: {
        kpis: {
          etudiantsActifs: parseInt(kpis.etudiants_actifs) || 0,
          professeursActifs: parseInt(kpis.professeurs_actifs) || 0,
          filieresOuvertes: parseInt(kpis.filieres_ouvertes) || 0,
          ticketsVendus: parseInt(kpis.tickets_vendus) || 0,
        },
        reclamations: reclamationsResult.rows,
        evenements: eventsResult.rows,
        alertes: {
          reclamationsNonTraitees: parseInt(alerts.reclamations_attente) || 0,
          publicationsEnAttente: parseInt(alerts.publications_attente) || 0,
          etudiantsSuspendus: parseInt(alerts.etudiants_suspendus) || 0,
        }
      }
    });

  } catch (error) {
    console.error('[Dashboard] Erreur récupération:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération du tableau de bord.' });
  }
};

module.exports = {
  getAdminDashboard
};
