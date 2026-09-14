const pool = require('../config/db');

const getNotesStatistiques = async (req, res) => {
    try {
        const query = `
            WITH student_averages AS (
                SELECT 
                    n.etudiant_id,
                    SUM(n.valeur * m.coefficient) / NULLIF(SUM(m.coefficient), 0) AS moyenne
                FROM notes n
                JOIN modules m ON n.module_id = m.id
                GROUP BY n.etudiant_id
            )
            SELECT 
                COALESCE(AVG(moyenne), 0) AS moyenne_promo,
                COUNT(*) AS total_students,
                COUNT(CASE WHEN moyenne >= 10 THEN 1 END) AS successful_students,
                COUNT(CASE WHEN moyenne >= 16 THEN 1 END) AS count_tb,
                COUNT(CASE WHEN moyenne >= 14 AND moyenne < 16 THEN 1 END) AS count_b,
                COUNT(CASE WHEN moyenne >= 12 AND moyenne < 14 THEN 1 END) AS count_ab,
                COUNT(CASE WHEN moyenne >= 10 AND moyenne < 12 THEN 1 END) AS count_p,
                COUNT(CASE WHEN moyenne < 10 THEN 1 END) AS count_f
            FROM student_averages;
        `;

        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            return res.status(200).json({
                taux_reussite: "0%",
                moyenne_promo: 0,
                repartition_mentions: { "TB": 0, "B": 0, "AB": 0, "P": 0, "F": 0 }
            });
        }

        const row = result.rows[0];
        const totalStudents = parseInt(row.total_students) || 0;
        const successfulStudents = parseInt(row.successful_students) || 0;
        
        let tauxReussite = "0%";
        if (totalStudents > 0) {
            tauxReussite = Math.round((successfulStudents / totalStudents) * 100) + "%";
        }

        const stats = {
            taux_reussite: tauxReussite,
            moyenne_promo: parseFloat(parseFloat(row.moyenne_promo).toFixed(1)),
            repartition_mentions: {
                "TB": parseInt(row.count_tb) || 0,
                "B": parseInt(row.count_b) || 0,
                "AB": parseInt(row.count_ab) || 0,
                "P": parseInt(row.count_p) || 0,
                "F": parseInt(row.count_f) || 0
            }
        };

        return res.status(200).json(stats);
    } catch (error) {
        console.error('Erreur récupération statistiques:', error);
        return res.status(500).json({ error: 'Erreur interne du serveur lors de la récupération des statistiques.' });
    }
};

// ── Évolution des inscriptions (12 derniers mois) ──────────────────────
// Pour chaque mois : nouvelles inscriptions étudiants (created_at) et
// total cumulé (base = étudiants déjà inscrits avant le début de la
// fenêtre de 12 mois + nouveaux mois par mois). Sert au graphique du
// tableau de bord admin.
const getInscriptionsParMois = async (req, res) => {
    try {
        const monthlyResult = await pool.query(`
            WITH mois AS (
                SELECT generate_series(
                    date_trunc('month', now()) - interval '11 months',
                    date_trunc('month', now()),
                    interval '1 month'
                ) AS mois
            ),
            inscriptions AS (
                SELECT date_trunc('month', created_at) AS mois, COUNT(*)::int AS nouveaux
                FROM users
                WHERE role ILIKE '%etudiant%' AND created_at IS NOT NULL
                GROUP BY 1
            )
            SELECT to_char(m.mois, 'YYYY-MM') AS mois, COALESCE(i.nouveaux, 0) AS nouveaux
            FROM mois m
            LEFT JOIN inscriptions i ON i.mois = m.mois
            ORDER BY m.mois
        `);

        const baseResult = await pool.query(`
            SELECT COUNT(*)::int AS base
            FROM users
            WHERE role ILIKE '%etudiant%'
              AND created_at < date_trunc('month', now()) - interval '11 months'
        `);
        let cumule = baseResult.rows[0]?.base || 0;

        const data = monthlyResult.rows.map((row) => {
            cumule += row.nouveaux;
            return { mois: row.mois, nouveaux: row.nouveaux, cumule };
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('[getInscriptionsParMois]', error);
        return res.status(500).json({ success: false, message: 'Erreur lors du calcul des inscriptions.' });
    }
};

module.exports = {
    getNotesStatistiques,
    getInscriptionsParMois,
};