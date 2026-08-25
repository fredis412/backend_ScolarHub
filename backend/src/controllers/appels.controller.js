const pool = require('../config/db');

// POST /api/appels - Créer un appel (présences) pour une classe/module
const createAppel = async (req, res) => {
    try {
        const { filiere_id, filiere_nom, niveau, module_id, presences } = req.body;
        const professeur_id = req.user.id;

        if (!filiere_id || !module_id) {
            return res.status(400).json({ success: false, message: 'filiere_id et module_id sont requis.' });
        }

        const appelResult = await pool.query(`
            INSERT INTO appels (filiere_id, filiere_nom, niveau, module_id, professeur_id)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [filiere_id, filiere_nom || '', niveau || 'Tous', module_id, professeur_id]);

        const appel_id = appelResult.rows[0].id;

        if (presences && presences.length > 0) {
            for (const p of presences) {
                if (!p.matricule) continue;
                const etudiantResult = await pool.query(
                    `SELECT id, nom, prenoms FROM etudiants WHERE matricule = $1`,
                    [p.matricule]
                );
                const etudiant = etudiantResult.rows[0];
                if (!etudiant) continue;
                await pool.query(`
                    INSERT INTO appel_presences (appel_id, etudiant_id, matricule, nom, prenoms, statut)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [appel_id, etudiant.id, p.matricule, etudiant.nom, etudiant.prenoms, p.statut || 'present']);
            }
        }

        res.status(201).json({ success: true, message: 'Appel enregistré avec succès.', appel_id });
    } catch (error) {
        console.error('[createAppel]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement de l\'appel.' });
    }
};

// GET /api/appels - Liste des appels du professeur connecté
const getAppels = async (req, res) => {
    try {
        const professeur_id = req.user.id;
        const result = await pool.query(`
            SELECT a.*, m.nom AS module_nom,
                COUNT(ap.id) FILTER (WHERE ap.statut = 'present') AS nb_presents,
                COUNT(ap.id) FILTER (WHERE ap.statut = 'absent') AS nb_absents,
                COUNT(ap.id) FILTER (WHERE ap.statut = 'retard') AS nb_retards
            FROM appels a
            JOIN modules m ON a.module_id = m.id
            LEFT JOIN appel_presences ap ON ap.appel_id = a.id
            WHERE a.professeur_id = $1
            GROUP BY a.id, m.nom
            ORDER BY a.date_appel DESC, a.created_at DESC
        `, [professeur_id]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('[getAppels]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des appels.' });
    }
};

// GET /api/appels/:id - Détail d'un appel
const getAppelDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const professeur_id = req.user.id;

        const appelResult = await pool.query(`
            SELECT a.*, m.nom AS module_nom
            FROM appels a
            JOIN modules m ON a.module_id = m.id
            WHERE a.id = $1
        `, [id]);
        const appel = appelResult.rows[0];
        if (!appel) return res.status(404).json({ success: false, message: 'Appel non trouvé.' });
        if (appel.professeur_id !== professeur_id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Accès refusé.' });
        }

        const presencesResult = await pool.query(`
            SELECT matricule, nom, prenoms, statut FROM appel_presences WHERE appel_id = $1 ORDER BY nom
        `, [id]);

        res.json({ success: true, data: { ...appel, presences: presencesResult.rows } });
    } catch (error) {
        console.error('[getAppelDetail]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de l\'appel.' });
    }
};

module.exports = { createAppel, getAppels, getAppelDetail };
