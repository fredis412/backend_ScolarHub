// Années académiques et inscriptions annuelles (étape 1 : passage de niveau et archives).
// Toutes les requêtes sont filtrées par l'établissement du jeton (req.etablissementId).
const pool = require('../config/db');

const LIBELLE = /^\d{4}-\d{4}$/;

// GET /api/annees  (admin) — toutes les années de l'établissement + nombre d'inscrits
const listerAnnees = async (req, res) => {
    try {
        const p = [];
        let where = '';
        if (req.etablissementId) { p.push(req.etablissementId); where = 'WHERE a.etablissement_id = $1'; }
        const r = await pool.query(
            `SELECT a.id, a.libelle, a.statut, a.date_rattrapage_debut, a.date_rattrapage_fin,
                    a.regle_rattrapage,
                    (SELECT COUNT(*) FROM inscriptions_annuelles ia
                      JOIN etudiants e ON e.id = ia.etudiant_id
                      WHERE ia.annee_academique = a.libelle
                        AND e.etablissement_id = a.etablissement_id) AS nb_inscrits
             FROM annees_academiques a ${where}
             ORDER BY a.libelle DESC`, p);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[listerAnnees]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des années.' });
    }
};

// GET /api/annees/courante  (tout utilisateur connecté)
const anneeCourante = async (req, res) => {
    try {
        const p = [];
        let where = "statut = 'en_cours'";
        if (req.etablissementId) { p.push(req.etablissementId); where += ' AND etablissement_id = $1'; }
        const r = await pool.query(
            `SELECT id, libelle, statut, date_rattrapage_debut, date_rattrapage_fin, regle_rattrapage
             FROM annees_academiques WHERE ${where} LIMIT 1`, p);
        res.json({ success: true, data: r.rows[0] || null });
    } catch (e) {
        console.error('[anneeCourante]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de l\'année en cours.' });
    }
};

// POST /api/annees  { libelle: '2026-2027' }  (admin)
// Refusé tant qu'une année est « en cours » : elle sera clôturée à l'étape 3.
const creerAnnee = async (req, res) => {
    try {
        const libelle = String(req.body?.libelle || '').trim();
        if (!LIBELLE.test(libelle)) {
            return res.status(400).json({ success: false, message: 'Format attendu : 2026-2027.' });
        }
        const [a, b] = libelle.split('-').map(Number);
        if (b !== a + 1) {
            return res.status(400).json({ success: false, message: 'Les deux années doivent se suivre (2026-2027).' });
        }
        if (!req.etablissementId) {
            return res.status(400).json({ success: false, message: 'Établissement inconnu dans votre session.' });
        }
        const enCours = await pool.query(
            "SELECT libelle FROM annees_academiques WHERE etablissement_id = $1 AND statut = 'en_cours'",
            [req.etablissementId]);
        if (enCours.rows.length) {
            return res.status(409).json({
                success: false,
                message: `L'année ${enCours.rows[0].libelle} est encore en cours. Clôturez-la avant d'en ouvrir une nouvelle.`,
            });
        }
        const r = await pool.query(
            `INSERT INTO annees_academiques (etablissement_id, libelle, statut)
             VALUES ($1, $2, 'en_cours') ON CONFLICT (etablissement_id, libelle) DO NOTHING RETURNING id`,
            [req.etablissementId, libelle]);
        if (!r.rows.length) {
            return res.status(409).json({ success: false, message: 'Cette année existe déjà.' });
        }
        res.status(201).json({ success: true, message: `Année ${libelle} ouverte.`, id: r.rows[0].id });
    } catch (e) {
        console.error('[creerAnnee]', e);
        res.status(500).json({ success: false, message: 'Erreur lors de la création de l\'année.' });
    }
};

// PUT /api/annees/:id/rattrapage  { date_debut, date_fin, regle: 'remplace'|'meilleure' }  (admin)
const reglerRattrapage = async (req, res) => {
    try {
        const { date_debut, date_fin, regle } = req.body || {};
        if (regle !== undefined && !['remplace', 'meilleure'].includes(regle)) {
            return res.status(400).json({ success: false, message: "regle doit être 'remplace' ou 'meilleure'." });
        }
        if (date_debut && date_fin && new Date(date_fin) < new Date(date_debut)) {
            return res.status(400).json({ success: false, message: 'La date de fin précède la date de début.' });
        }
        const p = [req.params.id, date_debut || null, date_fin || null, regle || 'remplace'];
        let etab = '';
        if (req.etablissementId) { p.push(req.etablissementId); etab = ' AND etablissement_id = $5'; }
        const r = await pool.query(
            `UPDATE annees_academiques
                SET date_rattrapage_debut = $2, date_rattrapage_fin = $3, regle_rattrapage = $4
              WHERE id = $1${etab} RETURNING id`, p);
        if (!r.rows.length) return res.status(404).json({ success: false, message: 'Année introuvable.' });
        res.json({ success: true, message: 'Paramètres du rattrapage enregistrés.' });
    } catch (e) {
        console.error('[reglerRattrapage]', e);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement.' });
    }
};

// GET /api/annees/:libelle/classe?filiere_id=&niveau=  (admin)
// Les étudiants d'une classe POUR CETTE ANNÉE-LÀ (même si leur niveau actuel a changé).
const classeDeLAnnee = async (req, res) => {
    try {
        const { filiere_id, niveau } = req.query;
        if (!filiere_id || !niveau) {
            return res.status(400).json({ success: false, message: 'filiere_id et niveau sont requis.' });
        }
        const p = [req.params.libelle, filiere_id, niveau];
        let etab = '';
        if (req.etablissementId) { p.push(req.etablissementId); etab = ' AND e.etablissement_id = $4'; }
        const r = await pool.query(
            `SELECT e.id, e.matricule, e.nom, e.prenoms, ia.decision
             FROM inscriptions_annuelles ia
             JOIN etudiants e ON e.id = ia.etudiant_id
             WHERE ia.annee_academique = $1 AND ia.filiere_id = $2 AND ia.niveau = $3${etab}
             ORDER BY e.nom, e.prenoms`, p);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[classeDeLAnnee]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de la classe.' });
    }
};

// GET /api/annees/mes-annees  (étudiant) — les années où il a été inscrit (sélecteur d'archives)
const mesAnnees = async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT ia.annee_academique, ia.niveau, f.nom AS filiere_nom, ia.decision
             FROM inscriptions_annuelles ia
             JOIN etudiants e ON e.id = ia.etudiant_id
             LEFT JOIN filieres f ON f.id = ia.filiere_id
             WHERE e.user_id = $1
             ORDER BY ia.annee_academique DESC`, [req.user.id]);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[mesAnnees]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de vos années.' });
    }
};

module.exports = { listerAnnees, anneeCourante, creerAnnee, reglerRattrapage, classeDeLAnnee, mesAnnees };
