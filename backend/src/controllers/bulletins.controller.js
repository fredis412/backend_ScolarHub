const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');

// ════════════════════════════════════════════════════════════════════════════
// BULLETINS — deux étapes distinctes, conçues avec Ib :
//
// PARTIE 1 — "Prévision de moyenne" (getPrevisionMoyenne) : tableau en
// lecture seule, un étudiant par ligne, un GROUPE de colonnes par module
// (Note 1, Note 2, ..., Moyenne du module — simple moyenne des notes de ce
// module, SANS coefficient). Sert juste à visualiser avant calcul final.
//
// PARTIE 2 — "Publication des bulletins" (getPreparationBulletin +
// publierBulletins) : reprend les mêmes moyennes de module, les pondère
// CETTE FOIS par le coefficient de chaque module (une seule fois par
// module, peu importe son nombre de devoirs) pour obtenir la moyenne
// générale. L'admin peut corriger cette moyenne générale à la main avant
// de choisir Validé/Ajourné/Invalidé et de publier.
//
// ⚠️ BUG CORRIGÉ — l'ancienne requête pondérait chaque NOTE individuelle
// par le coefficient de son module (SUM(n.valeur * m.coefficient) /
// SUM(m.coefficient) sur la table `notes` jointe directement), ce qui
// faisait peser un module avec 3 devoirs trois fois plus qu'un module à
// coefficient identique mais avec 1 seul devoir. Désormais : moyenne de
// chaque module d'abord (poids égal peu importe le nombre de devoirs),
// PUIS pondération par coefficient — un seul poids par module.
// ════════════════════════════════════════════════════════════════════════════

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
// Les bulletins sont rattachés à l'établissement par leur filière.
const filiereDeMonEtab = async (filiereId, etabId) => {
    if (!etabId) return true;
    if (filiereId === undefined || filiereId === null || filiereId === '') return false;
    const r = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [filiereId, etabId]);
    return r.rows.length > 0;
};
const REFUS_FILIERE = { success: false, message: 'Filière introuvable.' };

const APPRECIATIONS = ['Très bien', 'Bien', 'Assez bien', 'Passable', 'Insuffisant'];
const appreciationSuggeree = (m) => {
    if (m === null || m === undefined) return null;
    if (m >= 16) return 'Très bien';
    if (m >= 14) return 'Bien';
    if (m >= 12) return 'Assez bien';
    if (m >= 10) return 'Passable';
    return 'Insuffisant';
};

// Brique de calcul partagée entre Prévision et Bulletins — pour chaque
// étudiant de la filière+niveau, la liste de ses modules du semestre avec
// notes (dans l'ordre chronologique des sessions) + moyenne simple du
// module (sans coefficient).
const _calculerMoyennesModules = async (filiere_id, niveau, semestre, annee_academique) => {
    const modulesRes = await pool.query(`
        SELECT DISTINCT m.id, m.nom, m.coefficient
        FROM modules m
        JOIN sessions_notes sn ON sn.module_id = m.id
        WHERE m.filiere_id = $1 AND sn.semestre = $2 AND sn.annee_academique = $3 AND sn.statut = 'validee'
        ORDER BY m.nom
    `, [filiere_id, semestre, annee_academique]);
    const modules = modulesRes.rows;

    const etudiantsRes = await pool.query(
        `SELECT id, matricule, nom, prenoms FROM etudiants WHERE filiere_id = $1 AND niveau = $2 ORDER BY nom, prenoms`,
        [filiere_id, niveau]
    );

    if (modules.length === 0) {
        return { modules: [], etudiants: etudiantsRes.rows.map(e => ({ ...e, modules: [] })) };
    }

    const moduleIds = modules.map(m => m.id);
    const sessionsRes = await pool.query(`
        SELECT id, module_id FROM sessions_notes
        WHERE module_id = ANY($1::int[]) AND semestre = $2 AND annee_academique = $3 AND statut = 'validee'
        ORDER BY id ASC
    `, [moduleIds, semestre, annee_academique]);
    const sessionsParModule = {};
    for (const s of sessionsRes.rows) {
        sessionsParModule[s.module_id] ??= [];
        sessionsParModule[s.module_id].push(s.id);
    }
    const allSessionIds = sessionsRes.rows.map(s => s.id);

    let notesParEtudiantSession = {};
    if (allSessionIds.length > 0) {
        const notesRes = await pool.query(
            `SELECT etudiant_id, session_id, valeur FROM notes WHERE session_id = ANY($1::uuid[])`,
            [allSessionIds]
        );
        for (const row of notesRes.rows) {
            notesParEtudiantSession[row.etudiant_id] ??= {};
            notesParEtudiantSession[row.etudiant_id][row.session_id] = parseFloat(row.valeur);
        }
    }

    const etudiants = etudiantsRes.rows.map(e => {
        const modulesEtudiant = modules.map(m => {
            const sessionIds = sessionsParModule[m.id] || [];
            const notes = sessionIds.map(sid => notesParEtudiantSession[e.id]?.[sid] ?? null);
            const notesValides = notes.filter(n => n !== null);
            const moyenneModule = notesValides.length > 0
                ? Math.round((notesValides.reduce((s, n) => s + n, 0) / notesValides.length) * 100) / 100
                : null;
            return {
                module_id: m.id,
                module_nom: m.nom,
                coefficient: m.coefficient,
                notes,
                moyenne_module: moyenneModule,
            };
        });
        return { etudiant_id: e.id, matricule: e.matricule, nom: e.nom, prenoms: e.prenoms, modules: modulesEtudiant };
    });

    return { modules, etudiants };
};

const _moyenneGenerale = (modules) => {
    const avecNote = modules.filter(m => m.moyenne_module !== null);
    const sommeCoef = avecNote.reduce((s, m) => s + Number(m.coefficient || 0), 0);
    if (sommeCoef === 0) return null;
    const sommePonderee = avecNote.reduce((s, m) => s + m.moyenne_module * Number(m.coefficient || 0), 0);
    return Math.round((sommePonderee / sommeCoef) * 100) / 100;
};

// ════════════════════════════════════════════════════════════════════════════
// RÈGLES DE VALIDATION DU SEMESTRE (configurables par filière / niveau / semestre)
//
// Mode 'general' (défaut, cas de la plupart des filières) :
//   moyenne = Σ(moyenne module × coefficient) / Σ coefficients
//   semestre validé si moyenne >= seuil_validation (10 par défaut, réglable).
//
// Mode 'ue' (filières exigeantes) : les modules sont regroupés en UE
// (coefficient total d'une UE <= 6).
//   • moyenne UE = Σ(moyenne module × coef) / Σ coef des modules de l'UE
//   • toutes les UE >= seuil_ue (12)                → semestre validé
//   • une UE < seuil_compensation (7)               → semestre NON validé,
//       même avec une moyenne générale élevée
//   • sinon (UE entre 7 et 12) : compensation → moyenne générale pondérée par
//       le coefficient des UE ; validé si >= seuil_validation (12), sinon non.
//   • UE incomplète (module sans note) → résultat 'incomplet', pas de décision.
// ════════════════════════════════════════════════════════════════════════════
const COEF_MAX_UE = 6;
const REGLE_DEFAUT = { mode: 'general', seuil_validation: 10, seuil_ue: 12, seuil_compensation: 7, ues: [], par_defaut: true };

const _arrondi = (x) => Math.round(x * 100) / 100;

const _chargerRegle = async (filiere_id, niveau, semestre) => {
    try {
        const r = await pool.query(
            `SELECT mode, seuil_validation, seuil_ue, seuil_compensation, ues
             FROM regles_validation WHERE filiere_id = $1 AND niveau = $2 AND semestre = $3`,
            [filiere_id, niveau, semestre]
        );
        if (r.rows.length === 0) return { ...REGLE_DEFAUT };
        const row = r.rows[0];
        let ues = row.ues;
        if (typeof ues === 'string') { try { ues = JSON.parse(ues); } catch { ues = []; } }
        return {
            mode: row.mode === 'ue' ? 'ue' : 'general',
            seuil_validation: Number(row.seuil_validation),
            seuil_ue: Number(row.seuil_ue),
            seuil_compensation: Number(row.seuil_compensation),
            ues: Array.isArray(ues) ? ues : [],
            par_defaut: false,
        };
    } catch (err) {
        console.error('[_chargerRegle]', err.message);
        return { ...REGLE_DEFAUT };
    }
};

// modules : détail d'un étudiant [{ module_id, coefficient, moyenne_module, module_nom }]
const _evaluer = (modules, regle) => {
    const r = regle || REGLE_DEFAUT;
    if (r.mode !== 'ue') {
        const moy = _moyenneGenerale(modules);
        if (moy === null) return { moyenne: null, resultat: 'incomplet', motif: 'Aucune note', ues: [] };
        const ok = moy >= r.seuil_validation;
        return { moyenne: moy, resultat: ok ? 'valide' : 'non_valide',
                 motif: ok ? `Moyenne ≥ ${r.seuil_validation}` : `Moyenne < ${r.seuil_validation}`, ues: [] };
    }

    const parId = {};
    for (const m of modules) parId[String(m.module_id)] = m;
    const ues = (r.ues || []).map((ue, i) => {
        const ids = (ue.module_ids || []).map(String);
        const mods = ids.map(id => parId[id]).filter(Boolean);
        const complet = ids.length > 0 && mods.length === ids.length && mods.every(m => m.moyenne_module !== null);
        const coef = mods.reduce((s, m) => s + Number(m.coefficient || 0), 0);
        const moy = complet && coef > 0
            ? _arrondi(mods.reduce((s, m) => s + m.moyenne_module * Number(m.coefficient || 0), 0) / coef)
            : null;
        return {
            nom: ue.nom || `UE ${i + 1}`,
            couleur: ue.couleur || null,
            module_ids: ids,
            coefficient: coef,
            moyenne: moy,
            complet,
            valide: moy !== null && moy >= r.seuil_ue,
        };
    });

    if (ues.length === 0 || ues.some(u => !u.complet)) {
        return { moyenne: null, resultat: 'incomplet', motif: 'UE incomplète (notes manquantes)', ues };
    }
    const coefTotal = ues.reduce((s, u) => s + u.coefficient, 0);
    const moyGen = coefTotal > 0 ? _arrondi(ues.reduce((s, u) => s + u.moyenne * u.coefficient, 0) / coefTotal) : null;

    if (ues.every(u => u.valide)) {
        return { moyenne: moyGen, resultat: 'valide', motif: `Toutes les UE ≥ ${r.seuil_ue}`, ues };
    }
    const bloquante = ues.find(u => u.moyenne < r.seuil_compensation);
    if (bloquante) {
        return { moyenne: moyGen, resultat: 'non_valide', motif: `${bloquante.nom} < ${r.seuil_compensation} : pas de compensation`, ues };
    }
    if (moyGen !== null && moyGen >= r.seuil_validation) {
        return { moyenne: moyGen, resultat: 'valide_compensation', motif: `Compensation entre UE : moyenne ${moyGen} ≥ ${r.seuil_validation}`, ues };
    }
    return { moyenne: moyGen, resultat: 'non_valide', motif: `Compensation insuffisante : moyenne ${moyGen} < ${r.seuil_validation}`, ues };
};

// ── PARTIE 1 ──────────────────────────────────────────────────────────────
// GET /api/bulletins/prevision?filiere_id=&niveau=&semestre=&annee_academique=
const getPrevisionMoyenne = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique } = req.query;
        if (!filiere_id || !niveau || !semestre || !annee_academique) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau, semestre et annee_academique sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(404).json(REFUS_FILIERE);
        }
        const { modules, etudiants } = await _calculerMoyennesModules(filiere_id, niveau, semestre, annee_academique);
        res.json({ success: true, data: { modules, etudiants } });
    } catch (error) {
        console.error('[getPrevisionMoyenne]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul de la prévision.' });
    }
};

// ── PARTIE 2 ──────────────────────────────────────────────────────────────
// GET /api/bulletins/preparation?filiere_id=&niveau=&semestre=&annee_academique=
const getPreparationBulletin = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique } = req.query;
        if (!filiere_id || !niveau || !semestre || !annee_academique) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau, semestre et annee_academique sont requis.' });
        }

        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(404).json(REFUS_FILIERE);
        }

        const { modules: modulesListe, etudiants: etudiantsModules } = await _calculerMoyennesModules(filiere_id, niveau, semestre, annee_academique);
        const regle = await _chargerRegle(filiere_id, niveau, semestre);

        const bulletinsRes = await pool.query(
            `SELECT etudiant_id, id, statut, publie, date_publication, appreciation, moyenne_generale FROM bulletins WHERE semestre = $1 AND annee_academique = $2`,
            [semestre, annee_academique]
        );

        // Scolarité à régulariser : au moins un frais actif, échu et non payé.
        // N'empêche jamais le calcul si les tables de paiement sont absentes.
        const scolariteImpayee = new Set();
        try {
            const imp = await pool.query(
                `SELECT e.id FROM etudiants e
                 WHERE e.filiere_id = $1 AND e.niveau = $2
                   AND EXISTS (
                     SELECT 1 FROM frais_scolarite f
                     WHERE f.actif = TRUE AND (f.niveau IS NULL OR f.niveau = e.niveau)
                       AND f.echeance IS NOT NULL AND f.echeance < NOW()
                       AND NOT EXISTS (SELECT 1 FROM paiements p WHERE p.frais_id = f.id AND p.etudiant_id = e.id AND p.statut = 'reussi')
                   )`, [filiere_id, niveau]);
            for (const r of imp.rows) scolariteImpayee.add(String(r.id));
        } catch (errScol) {
            console.error('[getPreparationBulletin] scolarité', errScol.message);
        }
        const bulletinsParEtudiant = {};
        for (const b of bulletinsRes.rows) bulletinsParEtudiant[b.etudiant_id] = b;

        const filiereRes = await pool.query('SELECT nom FROM filieres WHERE id = $1', [filiere_id]);
        const filiereNom = filiereRes.rows[0]?.nom || '';

        const data = etudiantsModules.map(e => {
            const b = bulletinsParEtudiant[e.etudiant_id];
            const evaluation = _evaluer(e.modules, regle);
            const moyenneCalculee = evaluation.moyenne;
            return {
                resultat: evaluation.resultat,
                motif: evaluation.motif,
                ues_detail: evaluation.ues,
                statut_suggere: evaluation.resultat === 'valide' || evaluation.resultat === 'valide_compensation' ? 'valide' : 'ajourne',
                etudiant_id: e.etudiant_id,
                matricule: e.matricule,
                nom: e.nom,
                prenoms: e.prenoms,
                filiere_nom: filiereNom,
                niveau,
                moyenne_calculee: moyenneCalculee,
                nb_notes: e.modules.filter(m => m.moyenne_module !== null).length, // = nb modules pris en compte
                bulletin_id: b?.id || null,
                bulletin_statut: b?.statut || null,
                bulletin_publie: b?.publie === true,
                date_publication: b?.date_publication || null,
                appreciation: b?.appreciation || null,
                appreciation_suggeree: appreciationSuggeree(moyenneCalculee),
                moyenne_publiee: b?.moyenne_generale ?? null,
                scolarite_a_regulariser: scolariteImpayee.has(String(e.etudiant_id)),
                detail_modules: e.modules,
            };
        });

        res.json({
            success: true,
            data,
            modules: modulesListe.map(m => ({ id: m.id, nom: m.nom, coefficient: m.coefficient })),
            regle,
            modules_hors_ue: regle.mode === 'ue'
                ? modulesListe.filter(m => !regle.ues.some(u => (u.module_ids || []).map(String).includes(String(m.id)))).map(m => m.nom)
                : [],
        });
    } catch (error) {
        console.error('[getPreparationBulletin]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul des moyennes.' });
    }
};

// POST /api/bulletins/publier (admin)
// Body : { filiere_id, niveau, semestre, annee_academique,
//          resultats: [{ etudiant_id, statut, moyenne? }] }
// `moyenne` optionnel : si l'admin l'a corrigée à la main dans l'écran,
// cette valeur est utilisée telle quelle au lieu de la moyenne recalculée
// automatiquement — c'est le point "ces moyennes sont modifiables".
const publierBulletins = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique, resultats } = req.body;
        // publier=false → « Enregistrer sans publier » : gardé côté admin, invisible
        // aux étudiants, sans notification.
        const publier = req.body.publier !== false;
        const admin_id = req.user.id;

        if (!filiere_id || !niveau || !semestre || !annee_academique) {
            return res.status(400).json({
                success: false,
                message: 'filiere_id, niveau, semestre et annee_academique sont requis.',
            });
        }
        if (!Array.isArray(resultats) || resultats.length === 0) {
            return res.status(400).json({ success: false, message: 'Aucun résultat à publier.' });
        }
        const statutsValides = ['valide', 'ajourne', 'invalide'];
        for (const r of resultats) {
            if (!r.etudiant_id || !statutsValides.includes(r.statut)) {
                return res.status(400).json({
                    success: false,
                    message: `Statut invalide pour l'étudiant ${r.etudiant_id}. Attendu : valide, ajourne ou invalide.`,
                });
            }
        }

        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(404).json(REFUS_FILIERE);
        }

        const { etudiants: etudiantsModules } = await _calculerMoyennesModules(filiere_id, niveau, semestre, annee_academique);
        const regle = await _chargerRegle(filiere_id, niveau, semestre);
        const modulesParEtudiant = {};
        for (const e of etudiantsModules) modulesParEtudiant[e.etudiant_id] = e.modules;

        const publies = [];
        const echecs = [];

        const idsEtudiants = resultats.map(r => r.etudiant_id);
        const usersMap = {};
        if (idsEtudiants.length > 0) {
            const uRes = await pool.query(
                `SELECT id, user_id FROM etudiants WHERE id = ANY($1::int[])`,
                [idsEtudiants]
            );
            for (const row of uRes.rows) usersMap[row.id] = row.user_id;
        }

        for (const r of resultats) {
            try {
                // Avec un établissement, on ne publie que pour les étudiants de cette filière/niveau.
                if (req.etablissementId && !modulesParEtudiant[r.etudiant_id]) {
                    echecs.push({ etudiant_id: r.etudiant_id, raison: 'Étudiant hors de cette classe.' });
                    continue;
                }
                const modules = modulesParEtudiant[r.etudiant_id] || [];
                const evaluation = _evaluer(modules, regle);
                const moyenneCalculee = evaluation.moyenne;
                const moyenne = (r.moyenne !== undefined && r.moyenne !== null)
                    ? Number(r.moyenne)
                    : moyenneCalculee;

                const appreciation = APPRECIATIONS.includes(r.appreciation) ? r.appreciation : appreciationSuggeree(moyenne);
                const pubSql = publier ? 'true' : 'false';
                const upsert = await pool.query(`
                    INSERT INTO bulletins (
                        etudiant_id, filiere_id, niveau, semestre, annee_academique,
                        moyenne_generale, statut, publie, admin_id, date_publication, detail_modules, appreciation, detail_ues
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, ${pubSql}, $8, ${publier ? 'now()' : 'NULL'}, $9, $10, $11)
                    ON CONFLICT (etudiant_id, semestre, annee_academique)
                    DO UPDATE SET
                        moyenne_generale = EXCLUDED.moyenne_generale,
                        statut = EXCLUDED.statut,
                        publie = (bulletins.publie OR ${pubSql}),
                        admin_id = EXCLUDED.admin_id,
                        date_publication = ${publier ? 'now()' : 'bulletins.date_publication'},
                        detail_modules = EXCLUDED.detail_modules,
                        appreciation = EXCLUDED.appreciation,
                        detail_ues = EXCLUDED.detail_ues
                    RETURNING id, etudiant_id, moyenne_generale, statut
                `, [r.etudiant_id, filiere_id, niveau, semestre, annee_academique, moyenne, r.statut, admin_id, JSON.stringify(modules), appreciation, JSON.stringify(evaluation.ues)]);

                if (upsert.rows[0]) {
                    publies.push(upsert.rows[0]);
                    const destUserId = usersMap[r.etudiant_id];
                    if (publier && destUserId) {
                        envoyerNotificationAuto(
                            destUserId,
                            'Bulletin publié',
                            `Votre bulletin du ${semestre} (${annee_academique}) est disponible. Moyenne générale : ${moyenne ?? '--'}/20.`,
                            'bulletin',
                            { semestre, annee_academique }
                        ).catch(() => {});
                    }
                } else {
                    echecs.push({ etudiant_id: r.etudiant_id, raison: 'Aucune ligne retournée.' });
                }
            } catch (err) {
                console.error('[publierBulletins] echec etudiant', r.etudiant_id, err.message);
                echecs.push({ etudiant_id: r.etudiant_id, raison: err.message });
            }
        }

        res.json({
            success: publies.length > 0,
            message: echecs.length === 0
                ? `${publies.length} bulletin(s) ${publier ? 'publié(s)' : 'enregistré(s) sans publication'}.`
                : `${publies.length} bulletin(s) ${publier ? 'publié(s)' : 'enregistré(s)'}, ${echecs.length} échec(s).`,
            data: publies,
            echecs: echecs.length > 0 ? echecs : undefined,
        });
    } catch (error) {
        console.error('[publierBulletins]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la publication des bulletins.' });
    }
};

// GET /api/bulletins/mon-bulletin (étudiant connecté)
const getMonBulletin = async (req, res) => {
    try {
        const userId = req.user.id;

        const etudiantResult = await pool.query(
            `SELECT id, nom, prenoms, filiere_nom, niveau FROM etudiants WHERE user_id = $1`,
            [userId]
        );
        const etudiant = etudiantResult.rows[0];
        if (!etudiant) {
            return res.status(404).json({ success: false, message: 'Profil étudiant introuvable.' });
        }

        const result = await pool.query(`
            SELECT id, semestre, annee_academique, moyenne_generale, statut, appreciation, date_publication, detail_modules
            FROM bulletins
            WHERE etudiant_id = $1 AND publie = true
            ORDER BY annee_academique DESC, semestre DESC
        `, [etudiant.id]);

        res.json({
            success: true,
            data: result.rows,
            etudiant: {
                nom: etudiant.nom,
                prenoms: etudiant.prenoms,
                filiere_nom: etudiant.filiere_nom,
                niveau: etudiant.niveau,
            },
        });
    } catch (error) {
        console.error('[getMonBulletin]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement du bulletin.' });
    }
};

// POST /api/bulletins/prevision/envoyer (admin) — rend la prévision visible
// aux étudiants du groupe et les notifie. Ne fige rien : la prévision reste
// calculée en direct à chaque consultation, seule la "permission de voir"
// est enregistrée.
const envoyerPrevision = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique } = req.body;
        if (!filiere_id || !niveau || !semestre || !annee_academique) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau, semestre et annee_academique sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(404).json(REFUS_FILIERE);
        }
        await pool.query(
            `INSERT INTO previsions_envoyees (filiere_id, niveau, semestre, annee_academique, envoye_par)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (filiere_id, niveau, semestre, annee_academique)
             DO UPDATE SET envoye_par = EXCLUDED.envoye_par, created_at = now()`,
            [filiere_id, niveau, semestre, annee_academique, req.user.id]
        );

        (async () => {
            try {
                const etusRes = await pool.query(
                    `SELECT u.id FROM users u
                     JOIN etudiants e ON e.user_id = u.id
                     WHERE e.filiere_id = $1 AND e.niveau = $2
                       AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%')
                       AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye')`,
                    [filiere_id, niveau]
                );
                for (const e of etusRes.rows) {
                    await envoyerNotificationAuto(
                        e.id,
                        'Prévision de moyenne disponible',
                        `Vos moyennes par module pour ${semestre} (${annee_academique}) sont consultables — ce n'est pas encore le bulletin final.`,
                        'prevision',
                        null
                    );
                }
            } catch (notifErr) {
                console.error('[envoyerPrevision] notification', notifErr.message);
            }
        })();

        res.json({ success: true, message: 'Prévision envoyée aux étudiants.' });
    } catch (error) {
        console.error('[envoyerPrevision]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi.' });
    }
};

// GET /api/bulletins/mes-previsions (étudiant) — une entrée par envoi reçu
// pour sa filière+niveau, recalculée en direct (jamais figée).
const getMesPrevisions = async (req, res) => {
    try {
        const userId = req.user.id;
        const etuRes = await pool.query('SELECT id, filiere_id, niveau FROM etudiants WHERE user_id = $1', [userId]);
        const etu = etuRes.rows[0];
        if (!etu || !etu.filiere_id) {
            return res.json({ success: true, data: [] });
        }

        const envoisRes = await pool.query(
            `SELECT semestre, annee_academique, created_at FROM previsions_envoyees
             WHERE filiere_id = $1 AND niveau = $2
             ORDER BY annee_academique DESC, semestre DESC`,
            [etu.filiere_id, etu.niveau]
        );

        const previsions = [];
        for (const envoi of envoisRes.rows) {
            const { etudiants } = await _calculerMoyennesModules(etu.filiere_id, etu.niveau, envoi.semestre, envoi.annee_academique);
            const moi = etudiants.find(e => e.etudiant_id === etu.id);
            previsions.push({
                semestre: envoi.semestre,
                annee_academique: envoi.annee_academique,
                date_envoi: envoi.created_at,
                modules: moi ? moi.modules : [],
            });
        }

        res.json({ success: true, data: previsions });
    } catch (error) {
        console.error('[getMesPrevisions]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement.' });
    }
};

// GET /api/bulletins/regles?filiere_id=&niveau=&semestre=  (admin)
const getRegles = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre } = req.query;
        if (!filiere_id || !niveau || !semestre) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau et semestre sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(404).json(REFUS_FILIERE);
        }
        res.json({ success: true, data: await _chargerRegle(filiere_id, niveau, semestre) });
    } catch (error) {
        console.error('[getRegles]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des règles.' });
    }
};

// PUT /api/bulletins/regles  (admin)
// Body : { filiere_id, niveau, semestre, mode: 'general'|'ue', seuil_validation,
//          seuil_ue, seuil_compensation, ues: [{ nom, couleur, module_ids: [] }] }
const saveRegles = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, mode } = req.body || {};
        if (!filiere_id || !niveau || !semestre) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau et semestre sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(404).json(REFUS_FILIERE);
        }
        if (mode !== 'general' && mode !== 'ue') {
            return res.status(400).json({ success: false, message: "mode doit être 'general' ou 'ue'." });
        }
        const nombre = (v, defaut) => {
            const n = Number(v === undefined || v === null || v === '' ? defaut : v);
            return Number.isFinite(n) && n >= 0 && n <= 20 ? n : null;
        };
        const seuilValidation = nombre(req.body.seuil_validation, mode === 'ue' ? 12 : 10);
        const seuilUe = nombre(req.body.seuil_ue, 12);
        const seuilComp = nombre(req.body.seuil_compensation, 7);
        if (seuilValidation === null || seuilUe === null || seuilComp === null) {
            return res.status(400).json({ success: false, message: 'Les seuils doivent être compris entre 0 et 20.' });
        }

        let ues = [];
        if (mode === 'ue') {
            const brut = Array.isArray(req.body.ues) ? req.body.ues : [];
            if (brut.length === 0) {
                return res.status(400).json({ success: false, message: 'Ajoute au moins une UE.' });
            }
            const dejaPris = new Set();
            const tousIds = [];
            for (const ue of brut) for (const id of (ue.module_ids || [])) tousIds.push(Number(id));
            const coefParId = {};
            if (tousIds.length > 0) {
                const m = await pool.query(`SELECT id, coefficient FROM modules WHERE filiere_id = $1 AND id = ANY($2::int[])`, [filiere_id, tousIds]);
                for (const row of m.rows) coefParId[String(row.id)] = Number(row.coefficient || 0);
            }
            for (const [i, ue] of brut.entries()) {
                const nom = String(ue.nom || '').trim() || `UE ${i + 1}`;
                const ids = (ue.module_ids || []).map(String);
                if (ids.length === 0) {
                    return res.status(400).json({ success: false, message: `${nom} : choisis au moins un module.` });
                }
                let total = 0;
                for (const id of ids) {
                    if (coefParId[id] === undefined) {
                        return res.status(400).json({ success: false, message: `${nom} : module inconnu pour cette filière.` });
                    }
                    if (dejaPris.has(id)) {
                        return res.status(400).json({ success: false, message: `${nom} : un module ne peut appartenir qu'à une seule UE.` });
                    }
                    dejaPris.add(id);
                    total += coefParId[id];
                }
                if (total > COEF_MAX_UE) {
                    return res.status(400).json({ success: false, message: `${nom} : coefficient total ${total} > ${COEF_MAX_UE} (maximum autorisé).` });
                }
                ues.push({ nom, couleur: ue.couleur || null, module_ids: ids });
            }
        }

        await pool.query(
            `INSERT INTO regles_validation (filiere_id, niveau, semestre, mode, seuil_validation, seuil_ue, seuil_compensation, ues, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
             ON CONFLICT (filiere_id, niveau, semestre)
             DO UPDATE SET mode = EXCLUDED.mode, seuil_validation = EXCLUDED.seuil_validation, seuil_ue = EXCLUDED.seuil_ue,
                           seuil_compensation = EXCLUDED.seuil_compensation, ues = EXCLUDED.ues, updated_at = now()`,
            [filiere_id, niveau, semestre, mode, seuilValidation, seuilUe, seuilComp, JSON.stringify(ues)]
        );
        res.json({ success: true, message: 'Règles de validation enregistrées.' });
    } catch (error) {
        console.error('[saveRegles]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement des règles.' });
    }
};

module.exports = {
    getRegles,
    saveRegles,
    getPrevisionMoyenne,
    envoyerPrevision,
    getMesPrevisions,
    getPreparationBulletin,
    publierBulletins,
    getMonBulletin,
};