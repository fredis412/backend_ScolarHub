// Une année académique clôturée est en lecture seule : plus de saisie de notes,
// de validation de session ni de publication de bulletins pour cette année.
// Les années inconnues (jamais créées) ne sont pas bloquées.
const pool = require('../config/db');

// lire(req) renvoie le libellé de l'année visée (« 2025-2026 »), éventuellement en async.
// Par défaut : le champ annee_academique du corps de la requête.
const exigerAnneeOuverte = (lire = (req) => req.body && req.body.annee_academique) => async (req, res, next) => {
    try {
        const libelle = String((await lire(req)) || '').trim();
        if (!libelle) return next();
        const p = [libelle];
        let etab = '';
        if (req.etablissementId) { p.push(req.etablissementId); etab = ' AND etablissement_id = $2'; }
        const r = await pool.query(
            `SELECT 1 FROM annees_academiques WHERE libelle = $1${etab} AND statut = 'cloturee' LIMIT 1`, p);
        if (r.rows.length) {
            return res.status(403).json({
                success: false,
                message: `L'année ${libelle} est clôturée : elle est en lecture seule.`,
            });
        }
        next();
    } catch (e) {
        console.error('[exigerAnneeOuverte]', e.message);
        next(); // en cas de panne du contrôle, la route fait son travail habituel
    }
};

// Année d'une session de notes existante (routes /sessions/:session_id).
const anneeDeLaSession = async (req) => {
    const r = await pool.query('SELECT annee_academique FROM sessions_notes WHERE id = $1', [req.params.session_id]);
    return r.rows[0] ? r.rows[0].annee_academique : null;
};

module.exports = { exigerAnneeOuverte, anneeDeLaSession };
