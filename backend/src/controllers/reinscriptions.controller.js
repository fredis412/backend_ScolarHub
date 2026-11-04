// Réinscription (étape 3).
//  1. À l'ouverture de l'année, chaque étudiant admis ou redoublant reçoit une réinscription « a_faire ».
//  2. L'étudiant fait sa demande dans l'application (« demandee »), puis paie à la caisse.
//  3. L'administration valide en un clic avec la référence du reçu : seulement alors son niveau change.
// Les frais sont fixés par l'établissement pour chaque niveau.
const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');

const STATUTS = ['a_faire', 'demandee', 'validee', 'refusee'];

const anneeEnCours = async (etabId) => {
    const p = [];
    let where = "statut = 'en_cours'";
    if (etabId) { p.push(etabId); where += ' AND etablissement_id = $1'; }
    const r = await pool.query(`SELECT libelle FROM annees_academiques WHERE ${where} LIMIT 1`, p);
    return r.rows[0]?.libelle || null;
};

const fraisPour = async (etabId, niveau) => {
    if (!etabId || !niveau) return null;
    const r = await pool.query(
        'SELECT montant FROM frais_reinscription WHERE etablissement_id = $1 AND niveau = $2', [etabId, niveau]);
    return r.rows[0] ? Number(r.rows[0].montant) : null;
};

// ── GET /api/reinscriptions/mon-statut (étudiant) ───────────────────────────
// Dit à l'application si l'étudiant est à jour, diplômé, ou doit se réinscrire.
const monStatut = async (req, res) => {
    try {
        const etu = await pool.query(
            `SELECT e.id, e.filiere_id, e.niveau, e.etablissement_id,
                    COALESCE(e.parcours_statut, 'actif') AS parcours_statut, f.nom AS filiere_nom
             FROM etudiants e LEFT JOIN filieres f ON f.id = e.filiere_id
             WHERE e.user_id = $1`, [req.user.id]);
        const e = etu.rows[0];
        if (!e) return res.status(404).json({ success: false, message: 'Dossier étudiant introuvable.' });

        const annee = await anneeEnCours(e.etablissement_id);
        let aJour = true;
        if (annee) {
            const ia = await pool.query(
                'SELECT 1 FROM inscriptions_annuelles WHERE etudiant_id = $1 AND annee_academique = $2', [e.id, annee]);
            aJour = ia.rows.length > 0;
        }
        const derniere = await pool.query(
            `SELECT annee_academique, niveau, decision FROM inscriptions_annuelles
             WHERE etudiant_id = $1 AND decision IS NOT NULL ORDER BY annee_academique DESC LIMIT 1`, [e.id]);
        const re = annee ? await pool.query(
            `SELECT id, statut, niveau_cible, montant, reference_recu, motif_refus, decision_precedente
             FROM reinscriptions WHERE etudiant_id = $1 AND annee_academique = $2`, [e.id, annee]) : { rows: [] };
        const reinscription = re.rows[0] || null;
        // Jamais bloqué sans raison : sans réinscription à faire, un étudiant actif reste à jour.
        if (!aJour && !reinscription && e.parcours_statut === 'actif') aJour = true;
        const montant = reinscription ? await fraisPour(e.etablissement_id, reinscription.niveau_cible) : null;

        res.json({
            success: true,
            data: {
                annee_courante: annee,
                parcours: e.parcours_statut,
                a_jour: aJour,
                niveau_actuel: e.niveau,
                filiere_nom: e.filiere_nom || null,
                derniere_decision: derniere.rows[0] || null,
                reinscription: reinscription ? { ...reinscription, montant_a_payer: reinscription.montant ?? montant } : null,
            },
        });
    } catch (err) {
        console.error('[reinscriptions.monStatut]', err);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de votre situation.' });
    }
};

// ── POST /api/reinscriptions/demander (étudiant) ────────────────────────────
const demander = async (req, res) => {
    try {
        const etu = await pool.query('SELECT id, etablissement_id FROM etudiants WHERE user_id = $1', [req.user.id]);
        const e = etu.rows[0];
        if (!e) return res.status(404).json({ success: false, message: 'Dossier étudiant introuvable.' });
        const annee = await anneeEnCours(e.etablissement_id);
        if (!annee) return res.status(400).json({ success: false, message: 'Aucune année académique en cours.' });
        const r = await pool.query(
            `UPDATE reinscriptions SET statut = 'demandee', demandee_at = NOW(), motif_refus = NULL
             WHERE etudiant_id = $1 AND annee_academique = $2 AND statut IN ('a_faire', 'refusee')
             RETURNING id`, [e.id, annee]);
        if (!r.rows.length) {
            return res.status(404).json({ success: false, message: 'Aucune réinscription à demander pour le moment.' });
        }
        res.json({ success: true, message: 'Demande envoyée. Présente-toi à la caisse pour le paiement.' });
    } catch (err) {
        console.error('[reinscriptions.demander]', err);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi de la demande.' });
    }
};

// ── Frais de réinscription ──────────────────────────────────────────────────
// GET /api/reinscriptions/frais (admin)
const listerFrais = async (req, res) => {
    try {
        if (!req.etablissementId) return res.json({ success: true, data: { frais: [], niveaux_connus: [] } });
        const f = await pool.query(
            'SELECT niveau, montant FROM frais_reinscription WHERE etablissement_id = $1 ORDER BY niveau', [req.etablissementId]);
        const n = await pool.query(
            `SELECT DISTINCT niveau FROM etudiants WHERE etablissement_id = $1 AND COALESCE(niveau, '') <> '' ORDER BY niveau`,
            [req.etablissementId]);
        res.json({
            success: true,
            data: {
                frais: f.rows.map(x => ({ niveau: x.niveau, montant: Number(x.montant) })),
                niveaux_connus: n.rows.map(x => x.niveau),
            },
        });
    } catch (err) {
        console.error('[reinscriptions.listerFrais]', err);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des frais.' });
    }
};

// PUT /api/reinscriptions/frais (admin) body : { frais: [{ niveau, montant }] }
const enregistrerFrais = async (req, res) => {
    try {
        if (!req.etablissementId) {
            return res.status(400).json({ success: false, message: 'Établissement inconnu dans votre session.' });
        }
        const liste = Array.isArray(req.body?.frais) ? req.body.frais : [];
        for (const f of liste) {
            const niveau = String(f.niveau || '').trim();
            const montant = Number(String(f.montant).replace(/\s/g, '').replace(',', '.'));
            if (!niveau || !Number.isFinite(montant) || montant < 0) {
                return res.status(400).json({ success: false, message: `Montant invalide pour « ${niveau || '?'} ».` });
            }
            await pool.query(
                `INSERT INTO frais_reinscription (etablissement_id, niveau, montant) VALUES ($1, $2, $3)
                 ON CONFLICT (etablissement_id, niveau) DO UPDATE SET montant = EXCLUDED.montant, updated_at = NOW()`,
                [req.etablissementId, niveau, montant]);
        }
        res.json({ success: true, message: 'Frais de réinscription enregistrés.' });
    } catch (err) {
        console.error('[reinscriptions.enregistrerFrais]', err);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement des frais.' });
    }
};

// ── GET /api/reinscriptions/admin?statut= (admin) ───────────────────────────
// statut : a_faire | demandee | validee | refusee | tous (défaut : demandee)
const listerAdmin = async (req, res) => {
    try {
        const annee = await anneeEnCours(req.etablissementId);
        if (!annee) return res.json({ success: true, data: { annee: null, compteurs: {}, reinscriptions: [] } });
        const statut = STATUTS.includes(req.query.statut) || req.query.statut === 'tous' ? req.query.statut : 'demandee';

        const pc = [annee];
        let etabC = '';
        if (req.etablissementId) { pc.push(req.etablissementId); etabC = ' AND e.etablissement_id = $2'; }
        const c = await pool.query(
            `SELECT r.statut, COUNT(*) AS n FROM reinscriptions r JOIN etudiants e ON e.id = r.etudiant_id
             WHERE r.annee_academique = $1${etabC} GROUP BY r.statut`, pc);
        const compteurs = { a_faire: 0, demandee: 0, validee: 0, refusee: 0 };
        c.rows.forEach(x => { compteurs[x.statut] = Number(x.n); });

        const p = [annee];
        let where = 'r.annee_academique = $1';
        if (statut !== 'tous') { p.push(statut); where += ` AND r.statut = $${p.length}`; }
        if (req.etablissementId) { p.push(req.etablissementId); where += ` AND e.etablissement_id = $${p.length}`; }
        const r = await pool.query(
            `SELECT r.id, r.statut, r.niveau_precedent, r.niveau_cible, r.decision_precedente, r.montant,
                    r.reference_recu, r.motif_refus, r.demandee_at, r.validee_at,
                    e.id AS etudiant_id, e.matricule, e.nom, e.prenoms, f.nom AS filiere_nom,
                    (SELECT fr.montant FROM frais_reinscription fr
                      WHERE fr.etablissement_id = e.etablissement_id AND fr.niveau = r.niveau_cible) AS montant_prevu
             FROM reinscriptions r
             JOIN etudiants e ON e.id = r.etudiant_id
             LEFT JOIN filieres f ON f.id = r.filiere_id
             WHERE ${where}
             ORDER BY r.demandee_at NULLS LAST, e.nom, e.prenoms`, p);
        res.json({
            success: true,
            data: {
                annee, compteurs,
                reinscriptions: r.rows.map(x => ({
                    ...x,
                    montant: x.montant === null ? null : Number(x.montant),
                    montant_prevu: x.montant_prevu === null ? null : Number(x.montant_prevu),
                })),
            },
        });
    } catch (err) {
        console.error('[reinscriptions.listerAdmin]', err);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des réinscriptions.' });
    }
};

// ── PATCH /api/reinscriptions/admin/:id/valider (admin) ─────────────────────
// body : { reference_recu, montant? } — un clic : le niveau de l'étudiant change ici.
// La couche base de données du projet n'accepte pas les transactions (BEGIN/COMMIT) :
// on enchaîne donc des requêtes rejouables, et on remet la réinscription dans son état
// d'origine si une étape échoue.
const valider = async (req, res) => {
    const reference = String(req.body?.reference_recu || '').trim();
    if (!reference) {
        return res.status(400).json({ success: false, message: 'Indique la référence du reçu de paiement.' });
    }
    let priseEnCharge = null; // { id, statut } pour pouvoir annuler si une étape échoue
    try {
        const annee = await anneeEnCours(req.etablissementId);
        if (!annee) return res.status(400).json({ success: false, message: 'Aucune année académique en cours.' });

        const p = [req.params.id];
        let etab = '';
        if (req.etablissementId) { p.push(req.etablissementId); etab = ' AND e.etablissement_id = $2'; }
        const s = await pool.query(
            `SELECT r.*, e.user_id, e.etablissement_id FROM reinscriptions r JOIN etudiants e ON e.id = r.etudiant_id
             WHERE r.id = $1${etab}`, p);
        const r = s.rows[0];
        if (!r) return res.status(404).json({ success: false, message: 'Réinscription introuvable.' });
        if (r.annee_academique !== annee) {
            return res.status(409).json({ success: false, message: 'Cette réinscription ne concerne pas l\'année en cours.' });
        }
        if (r.statut === 'validee') {
            return res.status(409).json({ success: false, message: 'Réinscription déjà validée.' });
        }

        let montant = req.body?.montant;
        montant = (montant === undefined || montant === null || String(montant).trim() === '')
            ? await fraisPour(r.etablissement_id, r.niveau_cible)
            : Number(String(montant).replace(/\s/g, '').replace(',', '.'));
        if (montant !== null && !Number.isFinite(montant)) {
            return res.status(400).json({ success: false, message: 'Montant invalide.' });
        }

        // 1) Prise en charge : un seul clic peut valider (protège d'un double clic)
        const claim = await pool.query(
            `UPDATE reinscriptions
                SET statut = 'validee', reference_recu = $2, montant = $3, validee_at = NOW(), validee_par = $4, motif_refus = NULL
              WHERE id = $1 AND statut <> 'validee' RETURNING id`,
            [r.id, reference, montant, String(req.user.id)]);
        if (!claim.rows.length) {
            return res.status(409).json({ success: false, message: 'Réinscription déjà validée.' });
        }
        priseEnCharge = { id: r.id, statut: r.statut };

        // 2) Le niveau change seulement ici
        await pool.query(
            `UPDATE etudiants SET niveau = $2, filiere_id = COALESCE($3, filiere_id), parcours_statut = 'actif' WHERE id = $1`,
            [r.etudiant_id, r.niveau_cible, r.filiere_id]);
        // 3) La ligne de l'année en cours (le déclencheur de l'étape 1 la crée aussi ; ceci la garantit)
        await pool.query(
            `INSERT INTO inscriptions_annuelles (etudiant_id, annee_academique, filiere_id, niveau)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (etudiant_id, annee_academique)
             DO UPDATE SET filiere_id = EXCLUDED.filiere_id, niveau = EXCLUDED.niveau`,
            [r.etudiant_id, annee, r.filiere_id, r.niveau_cible]);

        res.json({ success: true, message: `Réinscription validée : l'étudiant passe en ${r.niveau_cible}.` });

        if (r.user_id) {
            envoyerNotificationAuto(r.user_id, 'Réinscription validée',
                `Ta réinscription pour ${annee} est validée (${r.niveau_cible}). Bonne année !`, 'info', null).catch(() => {});
        }
    } catch (err) {
        console.error('[reinscriptions.valider]', err);
        if (priseEnCharge) {
            // On remet la demande comme avant pour que l'administration puisse réessayer.
            await pool.query(
                `UPDATE reinscriptions SET statut = $2, reference_recu = NULL, validee_at = NULL, validee_par = NULL WHERE id = $1`,
                [priseEnCharge.id, priseEnCharge.statut]).catch(() => {});
        }
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Erreur lors de la validation.' });
    }
};

// ── PATCH /api/reinscriptions/admin/:id/refuser (admin) body : { motif } ────
const refuser = async (req, res) => {
    try {
        const motif = String(req.body?.motif || '').trim();
        if (!motif) return res.status(400).json({ success: false, message: 'Indique le motif du refus.' });
        const p = [req.params.id, motif];
        let etab = '';
        if (req.etablissementId) { p.push(req.etablissementId); etab = ' AND r.etudiant_id IN (SELECT id FROM etudiants WHERE etablissement_id = $3)'; }
        const r = await pool.query(
            `UPDATE reinscriptions r SET statut = 'refusee', motif_refus = $2
             WHERE r.id = $1 AND r.statut <> 'validee'${etab} RETURNING r.etudiant_id`, p);
        if (!r.rows.length) return res.status(404).json({ success: false, message: 'Réinscription introuvable ou déjà validée.' });
        res.json({ success: true, message: 'Demande refusée : l\'étudiant peut la refaire.' });

        const u = await pool.query('SELECT user_id FROM etudiants WHERE id = $1', [r.rows[0].etudiant_id]);
        if (u.rows[0]?.user_id) {
            envoyerNotificationAuto(u.rows[0].user_id, 'Réinscription refusée', `Motif : ${motif}`, 'info', null).catch(() => {});
        }
    } catch (err) {
        console.error('[reinscriptions.refuser]', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Erreur lors du refus.' });
    }
};

module.exports = { monStatut, demander, listerFrais, enregistrerFrais, listerAdmin, valider, refuser };
