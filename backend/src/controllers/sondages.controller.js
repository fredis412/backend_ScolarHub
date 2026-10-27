// ════════════════════════════════════════════════════════════════════════
// SONDAGES — façon WhatsApp, entièrement configurables par le créateur :
// choix unique ou multiple, anonyme ou non, avec ou sans date de clôture.
// Un sondage est envoyé dans une conversation comme un message texte
// contenant "[SONDAGE]<id>" — aucune modification des tables de messages
// existantes n'est nécessaire.
// ════════════════════════════════════════════════════════════════════════
const pool = require('../config/db');

// ── Isolation par établissement ─────────────────────────────────────────────
// Un sondage appartient à l'établissement de son créateur (users.etablissement_id).
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
async function sondageDeMonEtab(req, id) {
    if (!req.etablissementId) return true;
    const r = await pool.query(
        `SELECT 1 FROM sondages s JOIN users u ON u.id = s.createur_id
         WHERE s.id = $1 AND u.etablissement_id = $2`,
        [id, req.etablissementId]
    );
    return r.rows.length > 0;
}

// POST /api/sondages
// Body : { question, options: string[], choix_multiple, anonyme, date_cloture? }
const creerSondage = async (req, res) => {
    try {
        const { question, options, choix_multiple, anonyme, date_cloture } = req.body;
        if (!question || !question.trim()) {
            return res.status(400).json({ success: false, message: 'La question est requise.' });
        }
        const optionsValides = Array.isArray(options) ? options.map(o => (o || '').trim()).filter(Boolean) : [];
        if (optionsValides.length < 2) {
            return res.status(400).json({ success: false, message: 'Au moins 2 options sont requises.' });
        }
        if (optionsValides.length > 12) {
            return res.status(400).json({ success: false, message: '12 options maximum.' });
        }

        const sondageRes = await pool.query(
            `INSERT INTO sondages (createur_id, question, choix_multiple, anonyme, date_cloture)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [req.user.id, question.trim(), choix_multiple === true, anonyme === true, date_cloture || null]
        );
        const sondageId = sondageRes.rows[0].id;

        for (let i = 0; i < optionsValides.length; i++) {
            await pool.query(
                `INSERT INTO sondage_options (sondage_id, texte, ordre) VALUES ($1, $2, $3)`,
                [sondageId, optionsValides[i], i]
            );
        }

        res.status(201).json({ success: true, id: sondageId });
    } catch (error) {
        console.error('[creerSondage]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la création du sondage.' });
    }
};

// GET /api/sondages/:id
// Renvoie la question, les options avec leur nombre de votes, et — UNIQUEMENT
// si le sondage n'est pas anonyme — la liste des votants par option.
const getSondage = async (req, res) => {
    try {
        const { id } = req.params;
        const sondageRes = await pool.query('SELECT * FROM sondages WHERE id = $1', [id]);
        const sondage = sondageRes.rows[0];
        if (!sondage || !(await sondageDeMonEtab(req, id))) {
            return res.status(404).json({ success: false, message: 'Sondage introuvable.' });
        }

        const optionsRes = await pool.query(
            `SELECT o.id, o.texte, o.ordre, COUNT(v.id) AS nb_votes
             FROM sondage_options o
             LEFT JOIN sondage_votes v ON v.option_id = o.id
             WHERE o.sondage_id = $1
             GROUP BY o.id, o.texte, o.ordre
             ORDER BY o.ordre`,
            [id]
        );

        let votantsParOption = {};
        if (!sondage.anonyme) {
            const votantsRes = await pool.query(
                `SELECT v.option_id, u.id AS user_id, u.nom, u.prenoms
                 FROM sondage_votes v
                 JOIN users u ON u.id = v.user_id
                 WHERE v.sondage_id = $1`,
                [id]
            );
            for (const row of votantsRes.rows) {
                votantsParOption[row.option_id] ??= [];
                votantsParOption[row.option_id].push({ user_id: row.user_id, nom: row.nom, prenoms: row.prenoms });
            }
        }

        const mesVotesRes = await pool.query(
            `SELECT option_id FROM sondage_votes WHERE sondage_id = $1 AND user_id = $2`,
            [id, req.user.id]
        );
        const mesVotes = mesVotesRes.rows.map(r => r.option_id);

        const totalVotants = new Set(
            (await pool.query('SELECT DISTINCT user_id FROM sondage_votes WHERE sondage_id = $1', [id])).rows.map(r => r.user_id)
        ).size;

        const cloture = sondage.cloture_manuelle ||
            (sondage.date_cloture && new Date(sondage.date_cloture) < new Date());

        res.json({
            success: true,
            data: {
                id: sondage.id,
                question: sondage.question,
                choix_multiple: sondage.choix_multiple,
                anonyme: sondage.anonyme,
                date_cloture: sondage.date_cloture,
                cloture,
                est_createur: sondage.createur_id === req.user.id,
                total_votants: totalVotants,
                mes_votes: mesVotes,
                options: optionsRes.rows.map(o => ({
                    id: o.id,
                    texte: o.texte,
                    nb_votes: parseInt(o.nb_votes, 10) || 0,
                    votants: votantsParOption[o.id] || null, // null si anonyme
                })),
            },
        });
    } catch (error) {
        console.error('[getSondage]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement du sondage.' });
    }
};

// POST /api/sondages/:id/voter — Body : { option_ids: string[] }
const voter = async (req, res) => {
    try {
        const { id } = req.params;
        const { option_ids } = req.body;
        const optionIds = Array.isArray(option_ids) ? option_ids : [];
        if (optionIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Sélectionnez au moins une option.' });
        }

        const sondageRes = await pool.query('SELECT * FROM sondages WHERE id = $1', [id]);
        const sondage = sondageRes.rows[0];
        if (!sondage || !(await sondageDeMonEtab(req, id))) {
            return res.status(404).json({ success: false, message: 'Sondage introuvable.' });
        }
        const cloture = sondage.cloture_manuelle ||
            (sondage.date_cloture && new Date(sondage.date_cloture) < new Date());
        if (cloture) {
            return res.status(400).json({ success: false, message: 'Ce sondage est clôturé.' });
        }
        if (!sondage.choix_multiple && optionIds.length > 1) {
            return res.status(400).json({ success: false, message: 'Ce sondage n\'accepte qu\'une seule réponse.' });
        }

        // Retire les votes précédents de cet utilisateur pour ce sondage
        // (permet de changer d'avis avant clôture).
        await pool.query(
            `DELETE FROM sondage_votes WHERE sondage_id = $1 AND user_id = $2`,
            [id, req.user.id]
        );
        for (const optionId of optionIds) {
            await pool.query(
                `INSERT INTO sondage_votes (sondage_id, option_id, user_id) VALUES ($1, $2, $3)`,
                [id, optionId, req.user.id]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[voter]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du vote.' });
    }
};

// PATCH /api/sondages/:id/cloturer — seul le créateur peut clôturer
const cloturerSondage = async (req, res) => {
    try {
        const { id } = req.params;
        const sondageRes = await pool.query('SELECT createur_id FROM sondages WHERE id = $1', [id]);
        const sondage = sondageRes.rows[0];
        if (!sondage) {
            return res.status(404).json({ success: false, message: 'Sondage introuvable.' });
        }
        if (sondage.createur_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Seul le créateur peut clôturer ce sondage.' });
        }
        await pool.query('UPDATE sondages SET cloture_manuelle = true WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('[cloturerSondage]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la clôture.' });
    }
};

module.exports = { creerSondage, getSondage, voter, cloturerSondage };