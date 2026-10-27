const pool = require('../config/db');

// Le filtre d'établissement (« AND col = $1 ») est ajouté par l'appelant ;
// sans établissement dans le jeton (anciens jetons) il n'y a ni filtre ni paramètre.
const run = (sql, etabId) => (etabId ? pool.query(sql, [etabId]) : pool.query(sql));

const safeCount = async (sql, etabId) => {
  try {
    const r = await run(sql, etabId);
    const val = r.rows[0]?.c ?? r.rows[0]?.count ?? 0;
    return parseInt(val) || 0;
  } catch (_) {
    return 0;
  }
};

const getAdminDashboard = async (req, res) => {
  try {
    const etabId = req.etablissementId || null;
    // Fragment « AND <col> = $1 » si l'établissement est connu, sinon rien.
    const f = (col) => (etabId ? ` AND ${col} = $1` : '');

    // 1. KPIs — chaque sous-requête est isolée pour qu'une erreur n'en bloque pas une autre
    const [etudiantsActifs, professeursActifs, filieresOuvertes, ticketsVendus] = await Promise.all([
      safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'etudiant'${f('etablissement_id')}`, etabId),
      safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'professeur'${f('etablissement_id')}`, etabId),
      safeCount(`SELECT COUNT(*)::int AS c FROM filieres WHERE 1=1${f('etablissement_id')}`, etabId),
      safeCount(
        `SELECT COUNT(*)::int AS c FROM evenement_inscriptions WHERE 1=1${
          etabId ? ' AND evenement_id IN (SELECT id FROM evenements WHERE etablissement_id = $1)' : ''
        }`,
        etabId
      ),
    ]);

    // 2. Réclamations récentes (limit 5)
    let reclamations = [];
    try {
      const reclamationsResult = await run(`
        SELECT r.*, u.nom, u.prenoms, m.nom AS module_nom
        FROM reclamations r
        JOIN users u ON u.id = r.etudiant_id
        LEFT JOIN modules m ON m.id::text = r.module_id::text
        WHERE 1=1${f('u.etablissement_id')}
        ORDER BY r.created_at DESC
        LIMIT 5
      `, etabId);
      reclamations = reclamationsResult.rows;
    } catch (_) {}

    // 3. Prochains événements (limit 3)
    let evenements = [];
    try {
      const eventsResult = await run(`
        SELECT id, titre, date_debut, lieu, prix, statut
        FROM evenements
        WHERE date_debut >= NOW()${f('etablissement_id')}
        ORDER BY date_debut ASC
        LIMIT 3
      `, etabId);
      evenements = eventsResult.rows;
    } catch (_) {}

    // 4. Alertes
    const [reclamationsAttente, publicationsAttente, etudiantsSuspendus] = await Promise.all([
      safeCount(
        `SELECT COUNT(*)::int AS c FROM reclamations r WHERE r.statut = 'en_attente'${
          etabId ? ' AND r.etudiant_id IN (SELECT id FROM users WHERE etablissement_id = $1)' : ''
        }`,
        etabId
      ),
      safeCount(`SELECT COUNT(*)::int AS c FROM annonces WHERE statut = 'en_attente'${f('etablissement_id')}`, etabId),
      safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'etudiant' AND statut = 'suspendu'${f('etablissement_id')}`, etabId),
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