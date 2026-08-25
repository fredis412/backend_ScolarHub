const pool = require('../config/db');

// POST /api/evaluations
const soumettreEvaluation = async (req, res) => {
    try {
        const { professeur_id, note, commentaire } = req.body;
        // On récupère l'ID de l'étudiant depuis le token JWT via le middleware d'auth
        const etudiant_id = req.user.id;

        if (!professeur_id || !note) {
            return res.status(400).json({ error: 'professeur_id et note sont requis.' });
        }

        // Vérification des bornes de la note
        if (note < 1 || note > 5) {
            return res.status(400).json({ error: 'La note doit être comprise entre 1 et 5.' });
        }

        const query = `
            INSERT INTO evaluations_professeurs (etudiant_id, professeur_id, note, commentaire)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        
        const result = await pool.query(query, [etudiant_id, professeur_id, note, commentaire]);
        
        return res.status(201).json({
            message: 'Évaluation soumise avec succès.',
            evaluation: result.rows[0]
        });
    } catch (error) {
        // Le code d'erreur Postgres '23505' correspond à une violation de contrainte d'unicité
        if (error.code === '23505') {
            return res.status(403).json({ error: "Vous avez déjà évalué ce professeur." });
        }
        console.error('Erreur soumission évaluation:', error);
        return res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
};

// GET /api/evaluations/resultats
const getResultats = async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id as professeur_id,
                p.nom,
                p.prenoms,
                COALESCE(AVG(e.note), 0)::numeric(10,2) as moyenne_notes,
                COUNT(e.id) as nombre_evaluations
            FROM users p
            LEFT JOIN evaluations_professeurs e ON p.id = e.professeur_id
            WHERE p.role = 'professeur'
            GROUP BY p.id, p.nom, p.prenoms
            ORDER BY moyenne_notes DESC NULLS LAST;
        `;
        
        const result = await pool.query(query);
        return res.status(200).json({ resultats: result.rows });
    } catch (error) {
        console.error('Erreur récupération résultats évaluations:', error);
        return res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
};

module.exports = {
    soumettreEvaluation,
    getResultats
};
