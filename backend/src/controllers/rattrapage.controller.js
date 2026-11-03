// Session de rattrapage (étape 2 : passage de niveau et archives).
//
// Règles (fixées avec l'administration) :
//  - Un étudiant est « en rattrapage » pour un semestre quand son bulletin NORMAL publié
//    n'est pas « valide » (ajourné ou invalidé).
//  - Mode général : il reprend les modules dont la moyenne est < 10.
//  - Mode UE      : il reprend les modules < 10 des UE non validées
//    (si aucun module n'est < 10, tous les modules de ces UE).
//  - Une seule note de rattrapage par module ; elle suit le même circuit que les notes :
//    professeur -> administration (validation) -> notification individuelle de l'étudiant.
//  - Le rattrapage a lieu une fois par an ; l'année académique est celle de la classe.
// Tables : sessions_rattrapage, notes_rattrapage (voir migration_rattrapage.sql).
const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');
const { parseSemestre } = require('../utils/semestres');

const SEUIL_MODULE = 10;

// ── Multi-établissement ─────────────────────────────────────────────────────
async function filiereDeMonEtab(filiereId, etabId) {
    if (!etabId) return true;
    if (filiereId === undefined || filiereId === null || filiereId === '') return false;
    const r = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [filiereId, etabId]);
    return r.rows.length > 0;
}
const etabEtu = (params, etabId, alias = 'e') => {
    if (!etabId) return '';
    params.push(etabId);
    return ` AND ${alias}.etablissement_id = $${params.length}`;
};
const etabFiliere = (params, etabId, col) => {
    if (!etabId) return '';
    params.push(etabId);
    return ` AND ${col} IN (SELECT id FROM filieres WHERE etablissement_id = $${params.length})`;
};

// ── Calcul des étudiants et modules à repasser (fonctions pures) ────────────
const asJson = (v, def) => {
    if (v === null || v === undefined) return def;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return def; } }
    return v;
};

// Modules qu'un étudiant doit repasser d'après SON bulletin normal d'un semestre.
const modulesARepasser = (bulletin) => {
    const mods = asJson(bulletin.detail_modules, []);
    const ues = asJson(bulletin.detail_ues, []);
    const modeUe = Array.isArray(ues) && ues.length > 0;
    const idsUeNonValidees = new Set();
    if (modeUe) {
        for (const ue of ues) {
            if (!ue.valide) for (const id of (ue.module_ids || [])) idsUeNonValidees.add(String(id));
        }
    }
    const note = (m) => (m.moyenne_module === null || m.moyenne_module === undefined ? null : Number(m.moyenne_module));
    const garde = (m) => (modeUe ? idsUeNonValidees.has(String(m.module_id)) : true);
    let retenus = mods.filter(m => note(m) !== null && note(m) < SEUIL_MODULE && garde(m));
    if (retenus.length === 0 && modeUe) retenus = mods.filter(m => idsUeNonValidees.has(String(m.module_id)));
    return retenus.map(m => ({
        module_id: m.module_id,
        module_nom: m.module_nom,
        coefficient: m.coefficient,
        semestre: bulletin.semestre,
        moyenne_normale: note(m),
    }));
};

// rows = bulletins normaux publiés d'une classe pour une année.
const analyser = (rows) => {
    const semestres = {};
    const etudiants = {};
    const modules = {};
    for (const b of rows) {
        const s = (semestres[b.semestre] ??= { semestre: b.semestre, nb_total: 0, nb_valides: 0, nb_rattrapage: 0 });
        s.nb_total += 1;
        if (b.statut === 'valide') { s.nb_valides += 1; continue; }
        s.nb_rattrapage += 1;
        const mods = modulesARepasser(b);
        const e = (etudiants[b.etudiant_id] ??= {
            etudiant_id: b.etudiant_id, matricule: b.matricule, nom: b.nom, prenoms: b.prenoms, modules: [],
        });
        for (const m of mods) {
            e.modules.push(m);
            const cle = String(m.module_id);
            const mm = (modules[cle] ??= {
                module_id: m.module_id, module_nom: m.module_nom, coefficient: m.coefficient,
                semestre: m.semestre, nb_concernes: 0,
            });
            mm.nb_concernes += 1;
        }
    }
    return {
        semestres: Object.values(semestres).sort((a, b) => String(a.semestre).localeCompare(String(b.semestre))),
        etudiants: Object.values(etudiants),
        modules: Object.values(modules),
    };
};

const chargerBulletinsNormaux = async (filiere_id, niveau, annee, etabId) => {
    const p = [filiere_id, niveau, annee];
    const r = await pool.query(
        `SELECT b.etudiant_id, b.semestre, b.statut, b.detail_modules, b.detail_ues,
                e.matricule, e.nom, e.prenoms
         FROM bulletins b JOIN etudiants e ON e.id = b.etudiant_id
         WHERE b.filiere_id = $1 AND b.niveau = $2 AND b.annee_academique = $3
           AND b.session_type = 'normale' AND b.publie = true${etabEtu(p, etabId)}
         ORDER BY e.nom, e.prenoms`, p);
    return r.rows;
};

const anneeCourante = async (etabId) => {
    const p = [];
    let where = "statut = 'en_cours'";
    if (etabId) { p.push(etabId); where += ' AND etablissement_id = $1'; }
    const r = await pool.query(
        `SELECT libelle, date_rattrapage_debut, date_rattrapage_fin, regle_rattrapage
         FROM annees_academiques WHERE ${where} LIMIT 1`, p);
    return r.rows[0] || null;
};

// ── GET /api/rattrapage/apercu?filiere_id=&niveau=&annee_academique= (prof/admin) ──
// Combien d'étudiants ont validé, combien sont en rattrapage, pour quels modules, et la liste.
const apercu = async (req, res) => {
    try {
        const { filiere_id, niveau } = req.query;
        if (!filiere_id || !niveau) {
            return res.status(400).json({ success: false, message: 'filiere_id et niveau sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(403).json({ success: false, message: 'Filière inconnue pour votre établissement.' });
        }
        const annee = await anneeCourante(req.etablissementId);
        const libelle = req.query.annee_academique || annee?.libelle;
        if (!libelle) return res.status(400).json({ success: false, message: 'Aucune année académique en cours.' });

        const rows = await chargerBulletinsNormaux(filiere_id, niveau, libelle, req.etablissementId);
        const a = analyser(rows);

        const sess = await pool.query(
            `SELECT id, module_id, statut, is_sent, motif_rejet FROM sessions_rattrapage
             WHERE filiere_id = $1 AND niveau = $2 AND annee_academique = $3`, [filiere_id, niveau, libelle]);
        const notes = sess.rows.length
            ? await pool.query(
                `SELECT session_id, etudiant_id, valeur FROM notes_rattrapage WHERE session_id = ANY($1::uuid[])`,
                [sess.rows.map(s => s.id)])
            : { rows: [] };
        const modules = a.modules.map(m => {
            const s = sess.rows.find(x => String(x.module_id) === String(m.module_id));
            return {
                ...m,
                session: s ? {
                    id: s.id, statut: s.statut, is_sent: s.is_sent, motif_rejet: s.motif_rejet,
                    notes: notes.rows.filter(n => n.session_id === s.id)
                        .map(n => ({ etudiant_id: n.etudiant_id, valeur: Number(n.valeur) })),
                } : null,
            };
        });
        res.json({
            success: true,
            data: {
                annee_academique: libelle,
                date_debut: annee?.date_rattrapage_debut || null,
                date_fin: annee?.date_rattrapage_fin || null,
                regle: annee?.regle_rattrapage || 'remplace',
                semestres: a.semestres,
                nb_etudiants_rattrapage: a.etudiants.length,
                etudiants: a.etudiants,
                modules,
            },
        });
    } catch (e) {
        console.error('[rattrapage.apercu]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement du rattrapage.' });
    }
};

// ── POST /api/rattrapage/sessions (professeur) ──────────────────────────────
// body : { filiere_id, niveau, module_id, annee_academique?, notes: [{ matricule, valeur }] }
// Seuls les étudiants concernés par CE module sont acceptés. Une note vide = absent (note normale conservée).
const creerSession = async (req, res) => {
    try {
        const { filiere_id, niveau, module_id } = req.body || {};
        const notes = Array.isArray(req.body?.notes) ? req.body.notes : [];
        if (!filiere_id || !niveau || !module_id) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau et module_id sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(403).json({ success: false, message: 'Filière inconnue pour votre établissement.' });
        }
        const annee = await anneeCourante(req.etablissementId);
        const libelle = req.body.annee_academique || annee?.libelle;
        if (!libelle) return res.status(400).json({ success: false, message: 'Aucune année académique en cours.' });

        const mod = await pool.query('SELECT nom, semestre FROM modules WHERE id = $1', [module_id]);
        if (!mod.rows[0]) return res.status(404).json({ success: false, message: 'Module introuvable.' });
           if (req.user.role === 'professeur') {
            const aff = await pool.query(
                'SELECT 1 FROM professeur_modules WHERE professeur_id = $1 AND module_id = $2 AND niveau = $3 LIMIT 1',
                [req.user.id, module_id, niveau]);
            if (!aff.rows.length) {
                return res.status(403).json({ success: false, message: "Vous n'enseignez pas ce module à ce niveau." });
            }
        }
        const sem = parseSemestre(mod.rows[0].semestre);
        if (sem === null) {
            return res.status(400).json({ success: false, message: "Ce module n'a pas de semestre défini." });
        }
        const semestre = `S${sem}`;

        // Étudiants réellement concernés par ce module
        const rows = await chargerBulletinsNormaux(filiere_id, niveau, libelle, req.etablissementId);
        const a = analyser(rows);
        const concernes = new Map();
        for (const e of a.etudiants) {
            if (e.modules.some(m => String(m.module_id) === String(module_id))) concernes.set(String(e.matricule), e.etudiant_id);
        }
        if (concernes.size === 0) {
            return res.status(400).json({ success: false, message: 'Aucun étudiant en rattrapage pour ce module.' });
        }

        const existante = await pool.query(
            `SELECT id, statut, professeur_id FROM sessions_rattrapage
             WHERE module_id = $1 AND filiere_id = $2 AND niveau = $3 AND annee_academique = $4`,
            [module_id, filiere_id, niveau, libelle]);
        let sessionId;
        const uid = String(req.user.id);
        if (existante.rows[0]) {
            const s = existante.rows[0];
            if (s.statut === 'validee') {
                return res.status(409).json({ success: false, message: 'Cette session est déjà validée par l\'administration.' });
            }
            if (s.professeur_id !== uid) {
                return res.status(403).json({ success: false, message: 'Cette session appartient à un autre professeur.' });
            }
            sessionId = s.id;
            await pool.query(
                `UPDATE sessions_rattrapage SET statut = 'en_attente', is_sent = false, motif_rejet = NULL WHERE id = $1`, [sessionId]);
            await pool.query('DELETE FROM notes_rattrapage WHERE session_id = $1', [sessionId]);
        } else {
            const ins = await pool.query(
                `INSERT INTO sessions_rattrapage (filiere_id, niveau, module_id, semestre, annee_academique, professeur_id)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [filiere_id, niveau, module_id, semestre, libelle, uid]);
            sessionId = ins.rows[0].id;
        }

        const avertissements = [];
        let enregistrees = 0;
        for (const n of notes) {
            if (n.valeur === undefined || n.valeur === null || String(n.valeur).trim() === '') continue; // absent
            const v = Number(String(n.valeur).replace(',', '.'));
            const etuId = concernes.get(String(n.matricule));
            if (!etuId) { avertissements.push({ matricule: n.matricule, raison: 'non concerné par ce rattrapage' }); continue; }
            if (!Number.isFinite(v) || v < 0 || v > 20) { avertissements.push({ matricule: n.matricule, raison: 'note invalide (0 à 20)' }); continue; }
            await pool.query('INSERT INTO notes_rattrapage (session_id, etudiant_id, valeur) VALUES ($1, $2, $3)', [sessionId, etuId, v]);
            enregistrees += 1;
        }
        res.status(201).json({
            success: true, session_id: sessionId, enregistrees,
            warnings: avertissements.length ? avertissements : undefined,
            message: `${enregistrees} note(s) de rattrapage enregistrée(s).`,
        });
    } catch (e) {
        console.error('[rattrapage.creerSession]', e);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement du rattrapage.' });
    }
};

// ── POST /api/rattrapage/sessions/:id/envoyer (professeur) ──────────────────
const envoyerSession = async (req, res) => {
    try {
        const p = [req.params.id, String(req.user.id)];
        const r = await pool.query(
            `UPDATE sessions_rattrapage SET is_sent = true
             WHERE id = $1 AND professeur_id = $2 AND statut <> 'validee'${etabFiliere(p, req.etablissementId, 'filiere_id')}
             RETURNING id`, p);
        if (!r.rows.length) return res.status(404).json({ success: false, message: 'Session introuvable ou déjà validée.' });
        res.json({ success: true, message: 'Session transmise à l\'administration.' });
    } catch (e) {
        console.error('[rattrapage.envoyerSession]', e);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi.' });
    }
};

// ── GET /api/rattrapage/mes-sessions (professeur) ───────────────────────────
const mesSessions = async (req, res) => {
    try {
        const p = [String(req.user.id)];
        const r = await pool.query(
            `SELECT s.id, s.niveau, s.semestre, s.annee_academique, s.statut, s.is_sent, s.motif_rejet, s.created_at,
                    m.nom AS module_nom, f.nom AS filiere_nom,
                    (SELECT COUNT(*) FROM notes_rattrapage n WHERE n.session_id = s.id) AS nb_notes
             FROM sessions_rattrapage s
             JOIN modules m ON m.id = s.module_id
             LEFT JOIN filieres f ON f.id = s.filiere_id
             WHERE s.professeur_id = $1${etabFiliere(p, req.etablissementId, 's.filiere_id')}
             ORDER BY s.created_at DESC`, p);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[rattrapage.mesSessions]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de vos sessions.' });
    }
};

// ── GET /api/rattrapage/sessions/:id (professeur propriétaire ou administration) ──
const detailSession = async (req, res) => {
    try {
        const p = [req.params.id];
        const s = await pool.query(
            `SELECT s.*, m.nom AS module_nom, f.nom AS filiere_nom
             FROM sessions_rattrapage s JOIN modules m ON m.id = s.module_id LEFT JOIN filieres f ON f.id = s.filiere_id
             WHERE s.id = $1${etabFiliere(p, req.etablissementId, 's.filiere_id')}`, p);
        const session = s.rows[0];
        if (!session) return res.status(404).json({ success: false, message: 'Session introuvable.' });
        const estAdmin = ['admin', 'direction'].includes(req.user.role);
        if (!estAdmin && session.professeur_id !== String(req.user.id)) {
            return res.status(403).json({ success: false, message: 'Accès refusé.' });
        }
        const n = await pool.query(
            `SELECT e.matricule, e.nom, e.prenoms, n.valeur
             FROM notes_rattrapage n JOIN etudiants e ON e.id = n.etudiant_id
             WHERE n.session_id = $1 ORDER BY e.nom, e.prenoms`, [session.id]);
        res.json({ success: true, data: { ...session, notes: n.rows } });
    } catch (e) {
        console.error('[rattrapage.detailSession]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de la session.' });
    }
};

// ── Administration ──────────────────────────────────────────────────────────
// GET /api/rattrapage/admin/sessions?statut=en_attente|validee|rejetee
const listerSessionsAdmin = async (req, res) => {
    try {
        const statut = ['en_attente', 'validee', 'rejetee'].includes(req.query.statut) ? req.query.statut : 'en_attente';
        const p = [statut];
        const r = await pool.query(
            `SELECT s.id, s.niveau, s.semestre, s.annee_academique, s.statut, s.is_sent, s.motif_rejet, s.created_at,
                    m.nom AS module_nom, f.nom AS filiere_nom,
                    u.nom AS prof_nom, u.prenoms AS prof_prenoms,
                    (SELECT COUNT(*) FROM notes_rattrapage n WHERE n.session_id = s.id) AS nb_notes
             FROM sessions_rattrapage s
             JOIN modules m ON m.id = s.module_id
             LEFT JOIN filieres f ON f.id = s.filiere_id
             LEFT JOIN users u ON u.id::text = s.professeur_id
             WHERE s.statut = $1 AND s.is_sent = true${etabFiliere(p, req.etablissementId, 's.filiere_id')}
             ORDER BY s.created_at DESC`, p);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[rattrapage.listerSessionsAdmin]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des sessions.' });
    }
};

// PATCH /api/rattrapage/admin/sessions/:id/valider — chaque étudiant reçoit SA note
const validerSession = async (req, res) => {
    try {
        const p = [req.params.id];
        const r = await pool.query(
            `UPDATE sessions_rattrapage SET statut = 'validee', validated_at = NOW(), motif_rejet = NULL
             WHERE id = $1 AND is_sent = true AND statut <> 'validee'${etabFiliere(p, req.etablissementId, 'filiere_id')}
             RETURNING id, module_id`, p);
        if (!r.rows.length) return res.status(404).json({ success: false, message: 'Session introuvable, non transmise ou déjà validée.' });
        res.json({ success: true, message: 'Notes de rattrapage validées et envoyées aux étudiants.' });

        (async () => {
            try {
                const m = await pool.query('SELECT nom FROM modules WHERE id = $1', [r.rows[0].module_id]);
                const moduleNom = m.rows[0]?.nom || 'un module';
                const etus = await pool.query(
                    `SELECT DISTINCT e.user_id FROM notes_rattrapage n JOIN etudiants e ON e.id = n.etudiant_id
                     WHERE n.session_id = $1 AND e.user_id IS NOT NULL`, [r.rows[0].id]);
                for (const row of etus.rows) {
                    await envoyerNotificationAuto(row.user_id, 'Note de rattrapage publiée',
                        `Ta note de rattrapage pour ${moduleNom} est disponible.`, 'note', null);
                }
            } catch (err) { console.error('[rattrapage.validerSession] notif', err.message); }
        })();
    } catch (e) {
        console.error('[rattrapage.validerSession]', e);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Erreur lors de la validation.' });
    }
};

// PATCH /api/rattrapage/admin/sessions/:id/rejeter  { motif }
const rejeterSession = async (req, res) => {
    try {
        const motif = String(req.body?.motif || '').trim();
        if (!motif) return res.status(400).json({ success: false, message: 'Indique le motif du rejet.' });
        const p = [req.params.id, motif];
        const r = await pool.query(
            `UPDATE sessions_rattrapage SET statut = 'rejetee', is_sent = false, motif_rejet = $2
             WHERE id = $1 AND statut <> 'validee'${etabFiliere(p, req.etablissementId, 'filiere_id')} RETURNING id`, p);
        if (!r.rows.length) return res.status(404).json({ success: false, message: 'Session introuvable ou déjà validée.' });
        res.json({ success: true, message: 'Session rejetée : le professeur peut la corriger.' });
    } catch (e) {
        console.error('[rattrapage.rejeterSession]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du rejet.' });
    }
};

// ── Étudiant ────────────────────────────────────────────────────────────────
// GET /api/rattrapage/ma-situation — suis-je en rattrapage, et pour quels modules ?
const maSituation = async (req, res) => {
    try {
        const etu = await pool.query(
            'SELECT id, filiere_id, niveau FROM etudiants WHERE user_id = $1', [req.user.id]);
        const e = etu.rows[0];
        if (!e || !e.filiere_id || !e.niveau) return res.json({ success: true, data: { en_rattrapage: false, semestres: [] } });
        const annee = await anneeCourante(req.etablissementId);
        if (!annee) return res.json({ success: true, data: { en_rattrapage: false, semestres: [] } });

        const r = await pool.query(
            `SELECT b.semestre, b.statut, b.detail_modules, b.detail_ues
             FROM bulletins b
             WHERE b.etudiant_id = $1 AND b.annee_academique = $2 AND b.session_type = 'normale' AND b.publie = true
             ORDER BY b.semestre`, [e.id, annee.libelle]);
        const semestres = r.rows
            .filter(b => b.statut !== 'valide')
            .map(b => ({ semestre: b.semestre, modules: modulesARepasser(b) }));
        res.json({
            success: true,
            data: {
                en_rattrapage: semestres.length > 0,
                annee_academique: annee.libelle,
                date_debut: annee.date_rattrapage_debut,
                date_fin: annee.date_rattrapage_fin,
                semestres,
            },
        });
    } catch (e) {
        console.error('[rattrapage.maSituation]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de votre situation.' });
    }
};

// GET /api/rattrapage/mes-notes — uniquement SES notes de rattrapage validées
const mesNotes = async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT n.valeur, s.semestre, s.annee_academique, m.id AS module_id, m.nom AS module_nom, m.coefficient
             FROM notes_rattrapage n
             JOIN sessions_rattrapage s ON s.id = n.session_id AND s.statut = 'validee'
             JOIN etudiants e ON e.id = n.etudiant_id
             JOIN modules m ON m.id = s.module_id
             WHERE e.user_id = $1
             ORDER BY s.annee_academique DESC, s.semestre, m.nom`, [req.user.id]);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[rattrapage.mesNotes]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de vos notes de rattrapage.' });
    }
};

module.exports = {
    apercu, creerSession, envoyerSession, mesSessions, detailSession,
    listerSessionsAdmin, validerSession, rejeterSession, maSituation, mesNotes,
    _test: { modulesARepasser, analyser },
};
