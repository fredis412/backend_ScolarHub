const pool = require('../config/db');

const { envoyerNotificationAuto } = require('./notifications.controller');
const { envoyerSMS } = require('../services/sms.service');

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
// Un appel est rattaché à l'établissement par sa filière (filieres.etablissement_id).
const filiereDeMonEtab = async (filiereId, etabId) => {
    if (!etabId) return true;
    if (filiereId === undefined || filiereId === null || filiereId === '') return false;
    const r = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [filiereId, etabId]);
    return r.rows.length > 0;
};

// POST /api/appels - Créer un appel (présences) pour une classe/module
const createAppel = async (req, res) => {
    try {
        const { filiere_id, filiere_nom, niveau, module_id, presences } = req.body;
        const professeur_id = req.user.id;

        if (!filiere_id || !module_id) {
            return res.status(400).json({ success: false, message: 'filiere_id et module_id sont requis.' });
        }

        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(404).json({ success: false, message: 'Filière introuvable.' });
        }

        // Fetch module_nom to use in notifications
        const moduleRes = await pool.query('SELECT nom FROM modules WHERE id = $1', [module_id]);
        const module_nom = moduleRes.rows.length > 0 ? moduleRes.rows[0].nom : 'Module';

        const appelResult = await pool.query(`
            INSERT INTO appels (filiere_id, filiere_nom, niveau, module_id, professeur_id)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [filiere_id, filiere_nom || '', niveau || 'Tous', module_id, professeur_id]);

        const appel_id = appelResult.rows[0].id;

        if (presences && presences.length > 0) {
            for (const p of presences) {
                if (!p.matricule) continue;
                const pe = [p.matricule];
                let filtreEtu = '';
                if (req.etablissementId) {
                    pe.push(req.etablissementId);
                    filtreEtu = ` AND etablissement_id = $${pe.length}`;
                }
                const etudiantResult = await pool.query(
                    `SELECT id, user_id, nom, prenoms, tel_parent FROM etudiants WHERE matricule = $1${filtreEtu}`,
                    pe
                );
                const etudiant = etudiantResult.rows[0];
                if (!etudiant) continue;
                
                const statut = p.statut || 'present';
                await pool.query(`
                    INSERT INTO appel_presences (appel_id, etudiant_id, matricule, nom, prenoms, statut)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [appel_id, etudiant.id, p.matricule, etudiant.nom, etudiant.prenoms, statut]);

                if (statut === 'absent') {
                    if (etudiant.user_id) {
                        await envoyerNotificationAuto(
                            etudiant.user_id,
                            'Absence enregistrée',
                            `Vous avez été marqué(e) absent(e) au cours de ${module_nom} (${filiere_nom || ''}).`
                        );
                    }
                    if (etudiant.tel_parent) {
                        await envoyerSMS(
                            etudiant.tel_parent,
                            `ScolarHub : ${etudiant.prenoms} ${etudiant.nom} a ete marque(e) absent(e) au cours de ${module_nom} aujourd'hui.`
                        );
                    }
                }
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
        const pa = [professeur_id];
        let filtreEtab = '';
        if (req.etablissementId) {
            pa.push(req.etablissementId);
            filtreEtab = ` AND a.filiere_id IN (SELECT id FROM filieres WHERE etablissement_id = $${pa.length})`;
        }
        const result = await pool.query(`
            SELECT a.*, m.nom AS module_nom,
                COUNT(ap.id) FILTER (WHERE ap.statut = 'present') AS nb_presents,
                COUNT(ap.id) FILTER (WHERE ap.statut = 'absent') AS nb_absents,
                COUNT(ap.id) FILTER (WHERE ap.statut = 'retard') AS nb_retards
            FROM appels a
            JOIN modules m ON a.module_id = m.id
            LEFT JOIN appel_presences ap ON ap.appel_id = a.id
            WHERE a.professeur_id = $1${filtreEtab}
            GROUP BY a.id, m.nom
            ORDER BY a.date_appel DESC, a.created_at DESC
        `, pa);

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
        if (!appel || !(await filiereDeMonEtab(appel.filiere_id, req.etablissementId))) {
            return res.status(404).json({ success: false, message: 'Appel non trouvé.' });
        }
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

// PUT /api/appels/:id - Modifier un appel
const updateAppel = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { presences } = req.body;
        const professeur_id = req.user.id;

        const appelResult = await client.query('SELECT professeur_id, filiere_id FROM appels WHERE id = $1', [id]);
        if (appelResult.rows.length === 0 || !(await filiereDeMonEtab(appelResult.rows[0].filiere_id, req.etablissementId))) return res.status(404).json({ success: false, message: 'Appel non trouvé.' });
        if (appelResult.rows[0].professeur_id !== professeur_id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Accès refusé.' });
        }

        if (presences && presences.length > 0) {
            await client.query('BEGIN');
            for (const p of presences) {
                if (!p.matricule) continue;
                const statut = p.statut || 'present';
                await client.query(`
                    UPDATE appel_presences SET statut = $1 
                    WHERE appel_id = $2 AND matricule = $3
                `, [statut, id, p.matricule]);
            }
            await client.query('COMMIT');
        }
        res.json({ success: true, message: 'Appel mis à jour avec succès.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[updateAppel]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de l\'appel.' });
    } finally {
        client.release();
    }
};

module.exports = { createAppel, getAppels, getAppelDetail, updateAppel };