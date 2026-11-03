// Décision de fin d'année, clôture et ouverture de l'année suivante (étape 3).
//
// Règles (fixées avec l'administration) :
//  - Pour chaque semestre de la classe, le résultat retenu est celui du bulletin « après rattrapage »
//    s'il existe, sinon celui du bulletin normal.
//  - Tous les semestres validés            -> admis (ou diplômé au dernier niveau : L3, M2).
//  - Un semestre non validé après rattrapage -> redoublement de toute l'année.
//  - Un semestre sans bulletin publié        -> « incomplet » : l'administration doit trancher.
//  - L'administration peut corriger une décision à la main avant de valider.
//  - La clôture rend l'année lecture seule et ouvre la suivante : rien n'est supprimé.
//    Le niveau de l'étudiant ne change qu'à sa réinscription validée.
const pool = require('../config/db');
const { estNiveauFinal, niveauSuivant, anneeSuivante } = require('../utils/niveaux');

const DECISIONS = ['admis', 'redoublant', 'diplome', 'abandon'];

const etabEtu = (params, etabId, alias = 'e') => {
    if (!etabId) return '';
    params.push(etabId);
    return ` AND ${alias}.etablissement_id = $${params.length}`;
};

async function filiereDeMonEtab(filiereId, etabId) {
    if (!etabId) return true;
    if (filiereId === undefined || filiereId === null || filiereId === '') return false;
    const r = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [filiereId, etabId]);
    return r.rows.length > 0;
}

const chargerAnnee = async (etabId, libelle) => {
    const p = [];
    let where = libelle ? 'libelle = $1' : "statut = 'en_cours'";
    if (libelle) p.push(libelle);
    if (etabId) { p.push(etabId); where += ` AND etablissement_id = $${p.length}`; }
    const r = await pool.query(
        `SELECT id, etablissement_id, libelle, statut, date_rattrapage_debut, date_rattrapage_fin, regle_rattrapage
         FROM annees_academiques WHERE ${where} LIMIT 1`, p);
    return r.rows[0] || null;
};

// ── Calcul des propositions pour une classe et une année ────────────────────
const calculerPropositions = async (annee, filiereId, niveau, etabId) => {
    const p = [annee, filiereId, niveau];
    const cls = await pool.query(
        `SELECT e.id AS etudiant_id, e.matricule, e.nom, e.prenoms,
                ia.decision, ia.decision_source, ia.decision_at
         FROM inscriptions_annuelles ia JOIN etudiants e ON e.id = ia.etudiant_id
         WHERE ia.annee_academique = $1 AND ia.filiere_id = $2 AND ia.niveau = $3${etabEtu(p, etabId)}
         ORDER BY e.nom, e.prenoms`, p);
    const bul = await pool.query(
        `SELECT etudiant_id, semestre, session_type, statut, moyenne_generale
         FROM bulletins
         WHERE annee_academique = $1 AND filiere_id = $2 AND niveau = $3 AND publie = true`,
        [annee, filiereId, niveau]);

    const semestres = [...new Set(bul.rows.filter(b => b.session_type === 'normale').map(b => b.semestre))].sort();
    const parEtu = new Map();
    for (const b of bul.rows) {
        const k = String(b.etudiant_id);
        if (!parEtu.has(k)) parEtu.set(k, {});
        const m = parEtu.get(k);
        (m[b.semestre] ??= {})[b.session_type === 'rattrapage' ? 'rattrapage' : 'normale'] = b;
    }
    const final = estNiveauFinal(niveau);

    const etudiants = cls.rows.map(e => {
        const m = parEtu.get(String(e.etudiant_id)) || {};
        let manquant = false;
        let toutValide = true;
        let rattrapageAttendu = false;
        const detail = semestres.map(s => {
            const n = m[s]?.normale || null;
            const r = m[s]?.rattrapage || null;
            const retenu = r || n;
            if (!retenu) { manquant = true; }
            else if (retenu.statut !== 'valide') { toutValide = false; }
            if (n && n.statut !== 'valide' && !r) rattrapageAttendu = true;
            return {
                semestre: s,
                statut_normal: n?.statut || null,
                moyenne_normale: n?.moyenne_generale ?? null,
                statut_final: retenu?.statut || null,
                moyenne_finale: retenu?.moyenne_generale ?? null,
                apres_rattrapage: !!r,
            };
        });
        let proposee;
        if (!semestres.length || manquant) proposee = 'incomplet';
        else if (toutValide) proposee = final ? 'diplome' : 'admis';
        else proposee = 'redoublant';
        return {
            etudiant_id: e.etudiant_id, matricule: e.matricule, nom: e.nom, prenoms: e.prenoms,
            semestres: detail,
            proposee,
            rattrapage_attendu: rattrapageAttendu && proposee === 'redoublant',
            decision: e.decision || null,
            decision_source: e.decision_source || null,
        };
    });
    return { semestres, niveau_final: final, etudiants };
};

const compter = (etudiants, cle) => {
    const r = { admis: 0, redoublant: 0, diplome: 0, abandon: 0, incomplet: 0, sans_decision: 0 };
    for (const e of etudiants) {
        const v = e[cle];
        if (v === null || v === undefined) { r.sans_decision += 1; continue; }
        if (r[v] !== undefined) r[v] += 1;
    }
    return r;
};

// ── GET /api/annuel/etat (admin) — avancement des décisions par classe ──────
const etat = async (req, res) => {
    try {
        const annee = await chargerAnnee(req.etablissementId, req.query.annee);
        if (!annee) return res.status(404).json({ success: false, message: 'Aucune année académique en cours.' });
        const p = [annee.libelle];
        const r = await pool.query(
            `SELECT ia.filiere_id, f.nom AS filiere_nom, ia.niveau,
                    COUNT(*) AS nb_etudiants,
                    COUNT(ia.decision) AS nb_decides,
                    COUNT(*) FILTER (WHERE ia.decision = 'admis')      AS nb_admis,
                    COUNT(*) FILTER (WHERE ia.decision = 'redoublant') AS nb_redoublants,
                    COUNT(*) FILTER (WHERE ia.decision = 'diplome')    AS nb_diplomes,
                    COUNT(*) FILTER (WHERE ia.decision = 'abandon')    AS nb_abandons
             FROM inscriptions_annuelles ia
             JOIN etudiants e ON e.id = ia.etudiant_id
             LEFT JOIN filieres f ON f.id = ia.filiere_id
             WHERE ia.annee_academique = $1${etabEtu(p, req.etablissementId)}
             GROUP BY ia.filiere_id, f.nom, ia.niveau
             ORDER BY f.nom, ia.niveau`, p);
        const classes = r.rows.map(c => ({
            ...c,
            nb_etudiants: Number(c.nb_etudiants), nb_decides: Number(c.nb_decides),
            nb_admis: Number(c.nb_admis), nb_redoublants: Number(c.nb_redoublants),
            nb_diplomes: Number(c.nb_diplomes), nb_abandons: Number(c.nb_abandons),
        }));
        const restants = classes.reduce((s, c) => s + (c.nb_etudiants - c.nb_decides), 0);
        res.json({
            success: true,
            data: {
                annee: annee.libelle, statut: annee.statut,
                prochaine_annee: anneeSuivante(annee.libelle),
                classes, sans_decision: restants,
                pret_a_cloturer: annee.statut === 'en_cours' && classes.length > 0 && restants === 0,
            },
        });
    } catch (e) {
        console.error('[annuel.etat]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de l\'avancement.' });
    }
};

// ── GET /api/annuel/decisions?filiere_id=&niveau=[&annee=] (admin) — aperçu ──
const apercuDecisions = async (req, res) => {
    try {
        const { filiere_id, niveau } = req.query;
        if (!filiere_id || !niveau) {
            return res.status(400).json({ success: false, message: 'filiere_id et niveau sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(403).json({ success: false, message: 'Filière inconnue pour votre établissement.' });
        }
        const annee = await chargerAnnee(req.etablissementId, req.query.annee);
        if (!annee) return res.status(404).json({ success: false, message: 'Année introuvable.' });
        const c = await calculerPropositions(annee.libelle, filiere_id, niveau, req.etablissementId);
        res.json({
            success: true,
            data: {
                annee: annee.libelle, statut: annee.statut,
                niveau, niveau_final: c.niveau_final,
                niveau_suivant: c.niveau_final ? null : niveauSuivant(niveau),
                semestres: c.semestres,
                resume_propose: compter(c.etudiants, 'proposee'),
                resume_enregistre: compter(c.etudiants, 'decision'),
                etudiants: c.etudiants,
            },
        });
    } catch (e) {
        console.error('[annuel.apercuDecisions]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul des décisions.' });
    }
};

// ── POST /api/annuel/decisions (admin) — valide toute la classe en une action ─
// body : { filiere_id, niveau, corrections?: { "<etudiant_id>": "admis|redoublant|diplome|abandon" }, forcer? }
// Chaque étudiant reçoit la décision proposée, sauf ceux corrigés à la main.
const validerDecisions = async (req, res) => {
    try {
        const { filiere_id, niveau } = req.body || {};
        const corrections = (req.body?.corrections && typeof req.body.corrections === 'object') ? req.body.corrections : {};
        if (!filiere_id || !niveau) {
            return res.status(400).json({ success: false, message: 'filiere_id et niveau sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(403).json({ success: false, message: 'Filière inconnue pour votre établissement.' });
        }
        const annee = await chargerAnnee(req.etablissementId);
        if (!annee) return res.status(404).json({ success: false, message: 'Aucune année académique en cours.' });

        const c = await calculerPropositions(annee.libelle, filiere_id, niveau, req.etablissementId);
        if (!c.etudiants.length) {
            return res.status(400).json({ success: false, message: 'Aucun étudiant dans cette classe.' });
        }

        const ids = []; const decisions = []; const sources = [];
        const incomplets = []; const invalides = []; let attendus = 0;
        for (const e of c.etudiants) {
            const corr = corrections[String(e.etudiant_id)];
            let d = corr ?? e.proposee;
            if (corr !== undefined && !DECISIONS.includes(corr)) { invalides.push(e.matricule); continue; }
            if (d === 'incomplet') { incomplets.push({ matricule: e.matricule, nom: e.nom, prenoms: e.prenoms }); continue; }
            if (d === 'admis' && c.niveau_final) d = 'diplome';
            if (corr === undefined && e.rattrapage_attendu) attendus += 1;
            ids.push(e.etudiant_id); decisions.push(d); sources.push(corr !== undefined ? 'manuelle' : 'auto');
        }
        if (invalides.length) {
            return res.status(400).json({ success: false, message: `Décision invalide pour : ${invalides.join(', ')}.` });
        }
        if (incomplets.length) {
            return res.status(409).json({
                success: false, incomplets,
                message: `${incomplets.length} étudiant(s) n'ont pas tous leurs bulletins publiés. Publiez-les ou choisissez leur décision à la main.`,
            });
        }
        if (attendus > 0 && req.body.forcer !== true) {
            return res.status(409).json({
                success: false, rattrapage_attendu: attendus,
                message: `${attendus} étudiant(s) ajourné(s) n'ont pas encore de bulletin après rattrapage : ils seraient déclarés redoublants.`,
            });
        }

        await pool.query(
            `UPDATE inscriptions_annuelles ia
                SET decision = x.d, decision_source = x.s, decision_at = NOW(), decision_par = $4
               FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS d, unnest($3::text[]) AS s) x
              WHERE ia.etudiant_id = x.id AND ia.annee_academique = $5`,
            [ids, decisions, sources, String(req.user.id), annee.libelle]);

        const resume = { admis: 0, redoublant: 0, diplome: 0, abandon: 0 };
        decisions.forEach(d => { resume[d] += 1; });
        res.json({ success: true, message: `Décisions enregistrées pour ${ids.length} étudiant(s).`, resume });
    } catch (e) {
        console.error('[annuel.validerDecisions]', e);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement des décisions.' });
    }
};

// ── POST /api/annuel/cloturer (admin) — clôture l'année et ouvre la suivante ─
// body : { prochaine_annee? } (par défaut l'année qui suit). Exige une décision pour chaque étudiant.
// La couche base de données du projet n'accepte pas les transactions : chaque étape est rejouable
// et l'ouverture de la nouvelle année est annulée (l'ancienne rouverte) si elle échoue.
const cloturerAnnee = async (req, res) => {
    if (!req.etablissementId) {
        return res.status(400).json({ success: false, message: 'Établissement inconnu dans votre session.' });
    }
    let ancienneFermee = null;
    try {
        const annee = await chargerAnnee(req.etablissementId);
        if (!annee) return res.status(404).json({ success: false, message: 'Aucune année académique en cours.' });
        const prochaine = String(req.body?.prochaine_annee || anneeSuivante(annee.libelle) || '').trim();
        const m = prochaine.match(/^(\d{4})-(\d{4})$/);
        if (!m || Number(m[2]) !== Number(m[1]) + 1) {
            return res.status(400).json({ success: false, message: 'Format de la prochaine année attendu : 2026-2027.' });
        }

        const sans = await pool.query(
            `SELECT COUNT(*) AS n FROM inscriptions_annuelles ia JOIN etudiants e ON e.id = ia.etudiant_id
             WHERE ia.annee_academique = $1 AND e.etablissement_id = $2 AND ia.decision IS NULL`,
            [annee.libelle, req.etablissementId]);
        if (Number(sans.rows[0].n) > 0) {
            return res.status(409).json({
                success: false, sans_decision: Number(sans.rows[0].n),
                message: `${sans.rows[0].n} étudiant(s) n'ont pas encore de décision. Validez toutes les classes avant de clôturer.`,
            });
        }
        const existe = await pool.query(
            'SELECT 1 FROM annees_academiques WHERE etablissement_id = $1 AND libelle = $2', [req.etablissementId, prochaine]);
        if (existe.rows.length) {
            return res.status(409).json({ success: false, message: `L'année ${prochaine} existe déjà.` });
        }

        const dec = await pool.query(
            `SELECT ia.etudiant_id, ia.filiere_id, ia.niveau, ia.decision
             FROM inscriptions_annuelles ia JOIN etudiants e ON e.id = ia.etudiant_id
             WHERE ia.annee_academique = $1 AND e.etablissement_id = $2`, [annee.libelle, req.etablissementId]);
        const diplomes = dec.rows.filter(r => r.decision === 'diplome').map(r => r.etudiant_id);
        const abandons = dec.rows.filter(r => r.decision === 'abandon').map(r => r.etudiant_id);
        const aReinscrire = dec.rows.filter(r => r.decision === 'admis' || r.decision === 'redoublant');

        // 1) Les réinscriptions à faire (rejouable : ON CONFLICT DO NOTHING)
        if (aReinscrire.length) {
            await pool.query(
                `INSERT INTO reinscriptions (etudiant_id, annee_academique, filiere_id, niveau_precedent, niveau_cible, decision_precedente)
                 SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[])
                 ON CONFLICT (etudiant_id, annee_academique) DO NOTHING`,
                [
                    aReinscrire.map(r => r.etudiant_id),
                    aReinscrire.map(() => prochaine),
                    aReinscrire.map(r => r.filiere_id),
                    aReinscrire.map(r => r.niveau),
                    aReinscrire.map(r => (r.decision === 'admis' ? (niveauSuivant(r.niveau) || r.niveau) : r.niveau)),
                    aReinscrire.map(r => r.decision),
                ]);
        }

        // 2) Clôture de l'ancienne année, puis ouverture de la nouvelle (annulée si elle échoue)
        await pool.query("UPDATE annees_academiques SET statut = 'cloturee' WHERE id = $1", [annee.id]);
        ancienneFermee = annee.id;
        await pool.query(
            `INSERT INTO annees_academiques (etablissement_id, libelle, statut, regle_rattrapage)
             VALUES ($1, $2, 'en_cours', $3)`, [req.etablissementId, prochaine, annee.regle_rattrapage || 'remplace']);
        ancienneFermee = null; // les deux années sont en place : plus rien à annuler

        // 3) Parcours des diplômés et des abandons
        if (diplomes.length) {
            await pool.query("UPDATE etudiants SET parcours_statut = 'diplome' WHERE id = ANY($1::int[])", [diplomes]);
        }
        if (abandons.length) {
            await pool.query("UPDATE etudiants SET parcours_statut = 'abandon' WHERE id = ANY($1::int[])", [abandons]);
        }

        res.json({
            success: true,
            message: `Année ${annee.libelle} clôturée. L'année ${prochaine} est ouverte.`,
            resume: {
                diplomes: diplomes.length, abandons: abandons.length,
                a_reinscrire: aReinscrire.length, annee_ouverte: prochaine,
            },
        });
    } catch (e) {
        console.error('[annuel.cloturerAnnee]', e);
        if (ancienneFermee) {
            await pool.query("UPDATE annees_academiques SET statut = 'en_cours' WHERE id = $1", [ancienneFermee]).catch(() => {});
        }
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Erreur lors de la clôture de l\'année.' });
    }
};

module.exports = { etat, apercuDecisions, validerDecisions, cloturerAnnee };
