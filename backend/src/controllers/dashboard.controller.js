const pool = require('../config/db');

const safeCount = async (sql) => {
  try {
    const r = await pool.query(sql);
    const val = r.rows[0]?.c ?? r.rows[0]?.count ?? 0;
    return parseInt(val) || 0;
  } catch (_) {
    return 0;
  }
};

const getAdminDashboard = async (req, res) => {
  try {
    // 1. KPIs — chaque sous-requête est isolée pour qu'une erreur n'en bloque pas une autre
    const [etudiantsActifs, professeursActifs, filieresOuvertes, ticketsVendus] = await Promise.all([
      safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'etudiant'`),
      safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'professeur'`),
      safeCount(`SELECT COUNT(*)::int AS c FROM filieres`),
      safeCount(`SELECT COUNT(*)::int AS c FROM evenement_inscriptions`),
    ]);

    // 2. Réclamations récentes (limit 5)
    let reclamations = [];
    try {
      const reclamationsResult = await pool.query(`
        SELECT r.*, u.nom, u.prenoms, m.nom AS module_nom
        FROM reclamations r
        JOIN users u ON u.id = r.etudiant_id
        LEFT JOIN modules m ON m.id::text = r.module_id::text
        ORDER BY r.created_at DESC
        LIMIT 5
      `);
      reclamations = reclamationsResult.rows;
    } catch (_) {}

    // 3. Prochains événements (limit 3)
    let evenements = [];
    try {
      const eventsResult = await pool.query(`
        SELECT id, titre, date_debut, lieu, prix, statut
        FROM evenements
        WHERE date_debut >= NOW()
        ORDER BY date_debut ASC
        LIMIT 3
      `);
      evenements = eventsResult.rows;
    } catch (_) {}

    // 4. Alertes
    const [reclamationsAttente, publicationsAttente, etudiantsSuspendus] = await Promise.all([
      safeCount(`SELECT COUNT(*)::int AS c FROM reclamations WHERE statut = 'en_attente'`),
      safeCount(`SELECT COUNT(*)::int AS c FROM annonces WHERE statut = 'en_attente'`),
      safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'etudiant' AND statut = 'suspendu'`),
    ]);

    res.json({
      success: true,
      data: {
        kpis: {
          etudiantsActifs,
          professeursActifs,
          filieresOuvertes,
          ticketsVendus,
        },
        reclamations,
        evenements,
        alertes: {
          reclamationsNonTraitees: reclamationsAttente,
          publicationsEnAttente: publicationsAttente,
          etudiantsSuspendus,
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
