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

module.exports = {
    getNotesStatistiques
};
