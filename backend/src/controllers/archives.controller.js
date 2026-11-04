// Archives (étape 3) : consultation en lecture seule des années passées.
// Rien n'est jamais supprimé ; un diplômé garde l'accès à ses bulletins.
const pool = require('../config/db');

const asJson = (v, def) => {
    if (v === null || v === undefined) return def;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return def; } }
    return v;
};

const bulletinsDe = async (etudiantId, annee) => {
    const r = await pool.query(
        `SELECT id, semestre, annee_academique, moyenne_generale, statut, appreciation, date_publication,
                detail_modules, session_type
         FROM bulletins
         WHERE etudiant_id = $1 AND annee_academique = $2 AND publie = true
         ORDER BY semestre, session_type`, [etudiantId, annee]);
    return r.rows.map(b => ({ ...b, detail_modules: asJson(b.detail_modules, []) }));
};

// ── GET /api/archives/mes-annees (étudiant) ─────────────────────────────────
// Les années où l'étudiant était inscrit, avec sa classe et la décision.
const mesAnnees = async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT ia.annee_academique, ia.niveau, f.nom AS filiere_nom, ia.decision,
                    COALESCE(a.statut, 'cloturee') AS statut_annee
             FROM inscriptions_annuelles ia
             JOIN etudiants e ON e.id = ia.etudiant_id
             LEFT JOIN filieres f ON f.id = ia.filiere_id
             LEFT JOIN annees_academiques a
                    ON a.libelle = ia.annee_academique AND a.etablissement_id = e.etablissement_id
             WHERE e.user_id = $1
             ORDER BY ia.annee_academique DESC`, [req.user.id]);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[archives.mesAnnees]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de vos années.' });
    }
};

// ── GET /api/archives/mon-annee?annee=2025-2026 (étudiant) ──────────────────
const monAnnee = async (req, res) => {
    try {
        const annee = String(req.query.annee || '').trim();
        if (!annee) return res.status(400).json({ success: false, message: 'annee est requis.' });
        const etu = await pool.query('SELECT id FROM etudiants WHERE user_id = $1', [req.user.id]);
        const e = etu.rows[0];
        if (!e) return res.status(404).json({ success: false, message: 'Dossier étudiant introuvable.' });
        const ia = await pool.query(
            `SELECT ia.annee_academique, ia.niveau, ia.decision, f.nom AS filiere_nom
             FROM inscriptions_annuelles ia LEFT JOIN filieres f ON f.id = ia.filiere_id
             WHERE ia.etudiant_id = $1 AND ia.annee_academique = $2`, [e.id, annee]);
        if (!ia.rows[0]) return res.status(404).json({ success: false, message: 'Vous n\'étiez pas inscrit cette année-là.' });
        res.json({ success: true, data: { ...ia.rows[0], bulletins: await bulletinsDe(e.id, annee) } });
    } catch (e) {
        console.error('[archives.monAnnee]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de l\'archive.' });
    }
};

// ── GET /api/archives/etudiant/:id (admin) — tout le parcours d'un étudiant ─
const parcoursEtudiant = async (req, res) => {
    try {
        const p = [req.params.id];
        let etab = '';
        if (req.etablissementId) { p.push(req.etablissementId); etab = ' AND e.etablissement_id = $2'; }
        const etu = await pool.query(
            `SELECT e.id, e.matricule, e.nom, e.prenoms, e.niveau, COALESCE(e.parcours_statut, 'actif') AS parcours_statut
             FROM etudiants e WHERE e.id = $1${etab}`, p);
        if (!etu.rows[0]) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
        const annees = await pool.query(
            `SELECT ia.annee_academique, ia.niveau, ia.decision, f.nom AS filiere_nom
             FROM inscriptions_annuelles ia LEFT JOIN filieres f ON f.id = ia.filiere_id
             WHERE ia.etudiant_id = $1 ORDER BY ia.annee_academique DESC`, [req.params.id]);
        const detail = [];
        for (const a of annees.rows) detail.push({ ...a, bulletins: await bulletinsDe(req.params.id, a.annee_academique) });
        res.json({ success: true, data: { etudiant: etu.rows[0], annees: detail } });
    } catch (e) {
        console.error('[archives.parcoursEtudiant]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement du parcours.' });
    }
};

// ── GET /api/archives/diplomes (admin) — les anciens ────────────────────────
const diplomes = async (req, res) => {
    try {
        const p = [];
        let etab = '';
        if (req.etablissementId) { p.push(req.etablissementId); etab = ' AND e.etablissement_id = $1'; }
        const r = await pool.query(
            `SELECT e.id, e.matricule, e.nom, e.prenoms, f.nom AS filiere_nom,
                    (SELECT ia.annee_academique FROM inscriptions_annuelles ia
                      WHERE ia.etudiant_id = e.id AND ia.decision = 'diplome'
                      ORDER BY ia.annee_academique DESC LIMIT 1) AS annee_diplome
             FROM etudiants e LEFT JOIN filieres f ON f.id = e.filiere_id
             WHERE e.parcours_statut = 'diplome'${etab}
             ORDER BY annee_diplome DESC NULLS LAST, e.nom, e.prenoms`, p);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[archives.diplomes]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des diplômés.' });
    }
};

module.exports = { mesAnnees, monAnnee, parcoursEtudiant, diplomes };
