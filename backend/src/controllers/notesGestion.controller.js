// Gestion admin des notes : stocker / transférer / archiver + moyennes provisoires par module.
// Aucune moyenne générale ici (elle est publiée séparément via le Bulletin).
const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');

const etabSession = (params, etabId, alias = 'sn') => {
    if (!etabId) return '';
    params.push(etabId);
    return ` AND ${alias}.filiere_id IN (SELECT id FROM filieres WHERE etablissement_id = $${params.length})`;
};
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
const listeIds = (body) => (Array.isArray(body?.ids) ? body.ids : []).filter(x => x !== null && x !== undefined && x !== '');

// PATCH /notes/sessions/admin/stocker  { ids: [...] }  -> garde côté admin, invisible aux étudiants
const stockerSessions = async (req, res) => {
    try {
        const ids = listeIds(req.body);
        if (!ids.length) return res.status(400).json({ success: false, message: 'Aucune session sélectionnée.' });
        let n = 0;
        for (const id of ids) {
            const p = [id];
            const r = await pool.query(
                `UPDATE sessions_notes SET statut = 'stockee', is_sent = false
                 WHERE id = $1 AND statut IN ('en_attente','stockee')${etabSession(p, req.etablissementId, 'sessions_notes')} RETURNING id`, p);
            n += r.rows.length;
        }
        res.json({ success: true, count: n, message: `${n} session(s) stockée(s).` });
    } catch (e) {
        console.error('[stockerSessions]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du stockage.' });
    }
};

// PATCH /notes/sessions/admin/transferer  { ids: [...] }  -> chaque étudiant reçoit SA note
const transfererSessions = async (req, res) => {
    try {
        const ids = listeIds(req.body);
        if (!ids.length) return res.status(400).json({ success: false, message: 'Aucune session sélectionnée.' });
        const faites = [];
        for (const id of ids) {
            const p = [id];
            const r = await pool.query(
                `UPDATE sessions_notes SET statut = 'validee', is_sent = true
                 WHERE id = $1 AND statut IN ('en_attente','stockee')${etabSession(p, req.etablissementId, 'sessions_notes')} RETURNING id, module_id`, p);
            if (r.rows.length) faites.push(r.rows[0]);
        }
        res.json({ success: true, count: faites.length, message: `${faites.length} session(s) transférée(s).` });

        // Notifications individuelles — non bloquantes
        (async () => {
            for (const s of faites) {
                try {
                    const m = await pool.query('SELECT nom FROM modules WHERE id = $1', [s.module_id]);
                    const moduleNom = m.rows[0]?.nom || 'un module';
                    const etus = await pool.query(
                        `SELECT DISTINCT e.user_id FROM notes n JOIN etudiants e ON e.id = n.etudiant_id
                         WHERE n.session_id = $1 AND e.user_id IS NOT NULL`, [s.id]);
                    for (const row of etus.rows) {
                        await envoyerNotificationAuto(row.user_id, 'Nouvelle note publiée',
                            `Une nouvelle note est disponible pour ${moduleNom}.`, 'note', null);
                    }
                } catch (err) { console.error('[transfererSessions] notif', err.message); }
            }
        })();
    } catch (e) {
        console.error('[transfererSessions]', e);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Erreur lors du transfert.' });
    }
};

// PATCH /notes/sessions/admin/archiver  { ids: [...], archive: true|false }
const archiverSessions = async (req, res) => {
    try {
        const ids = listeIds(req.body);
        if (!ids.length) return res.status(400).json({ success: false, message: 'Aucune session sélectionnée.' });
        const val = req.body.archive === false ? 'false' : 'true';
        let n = 0;
        for (const id of ids) {
            const p = [id];
            const r = await pool.query(
                `UPDATE sessions_notes SET archive = ${val} WHERE id = $1${etabSession(p, req.etablissementId, 'sessions_notes')} RETURNING id`, p);
            n += r.rows.length;
        }
        res.json({ success: true, count: n, message: val === 'true' ? `${n} session(s) archivée(s).` : `${n} session(s) restaurée(s).` });
    } catch (e) {
        console.error('[archiverSessions]', e);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'archivage.' });
    }
};

// ── Moyennes provisoires ────────────────────────────────────────────────────
// Calcule, pour filière+niveau+semestre(+année), la moyenne PAR MODULE de chaque
// étudiant = moyenne simple des devoirs (sessions transférées 'validee').
async function calculer(req, { filiere_id, niveau, semestre, annee_academique }) {
    const pS = [filiere_id, niveau, semestre];
    let filtreAnnee = '';
    if (annee_academique) { pS.push(annee_academique); filtreAnnee = ` AND sn.annee_academique = $${pS.length}`; }
    const sessions = await pool.query(
        `SELECT sn.id, sn.module_id, m.nom AS module_nom, m.coefficient
         FROM sessions_notes sn JOIN modules m ON m.id = sn.module_id
         WHERE sn.filiere_id = $1 AND (sn.niveau = $2 OR sn.niveau = 'Tous') AND sn.semestre = $3
           AND sn.statut = 'validee'${filtreAnnee}${etabSession(pS, req.etablissementId)}
         ORDER BY m.nom, sn.id`, pS);

    const modules = {};
    const sessionIds = [];
    for (const s of sessions.rows) {
        sessionIds.push(s.id);
        modules[s.module_id] ??= { id: s.module_id, nom: s.module_nom, coefficient: s.coefficient, nb_devoirs: 0 };
        modules[s.module_id].nb_devoirs += 1;
    }
    if (!sessionIds.length) return { modules: [], etudiants: [] };

    const pE = [filiere_id, niveau];
    const etus = await pool.query(
        `SELECT e.id, e.matricule, e.nom, e.prenoms FROM etudiants e
         WHERE e.filiere_id = $1 AND e.niveau = $2${etabEtu(pE, req.etablissementId)} ORDER BY e.nom, e.prenoms`, pE);

    const notes = [];
    for (const sid of sessionIds) {
        const r = await pool.query('SELECT etudiant_id, module_id, valeur FROM notes WHERE session_id = $1', [sid]);
        notes.push(...r.rows);
    }
    const parEtu = {};
    for (const n of notes) {
        const k = String(n.etudiant_id);
        parEtu[k] ??= {};
        parEtu[k][n.module_id] ??= [];
        parEtu[k][n.module_id].push(Number(n.valeur));
    }
    const etudiants = etus.rows.map(e => {
        const mods = {};
        for (const [mid, devoirs] of Object.entries(parEtu[String(e.id)] || {})) {
            const moy = devoirs.reduce((a, b) => a + b, 0) / devoirs.length;
            mods[mid] = { moyenne: Math.round(moy * 100) / 100, devoirs };
        }
        return { etudiant_id: e.id, matricule: e.matricule, nom: e.nom, prenoms: e.prenoms, modules: mods };
    });
    return { modules: Object.values(modules), etudiants };
}

// GET /notes/moyennes-provisoires/apercu?filiere_id=&niveau=&semestre=&annee_academique=
const apercuMoyennesProvisoires = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique } = req.query;
        if (!filiere_id || !niveau || !semestre) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau et semestre sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(403).json({ success: false, message: 'Filière inconnue pour votre établissement.' });
        }
        const data = await calculer(req, { filiere_id, niveau, semestre, annee_academique });
        const pDej = [filiere_id, niveau, semestre];
        const dej = await pool.query(
            `SELECT COUNT(DISTINCT etudiant_id) AS n FROM moyennes_provisoires
             WHERE filiere_id = $1 AND niveau = $2 AND semestre = $3`, pDej);
        res.json({ success: true, data: { ...data, deja_publiees: parseInt(dej.rows[0].n, 10) || 0 } });
    } catch (e) {
        console.error('[apercuMoyennesProvisoires]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul des moyennes provisoires.' });
    }
};

// POST /notes/moyennes-provisoires/publier  { filiere_id, niveau, semestre, annee_academique }
const publierMoyennesProvisoires = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique } = req.body || {};
        if (!filiere_id || !niveau || !semestre) {
            return res.status(400).json({ success: false, message: 'filiere_id, niveau et semestre sont requis.' });
        }
        if (!(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
            return res.status(403).json({ success: false, message: 'Filière inconnue pour votre établissement.' });
        }
        const { modules, etudiants } = await calculer(req, { filiere_id, niveau, semestre, annee_academique });
        if (!modules.length) {
            return res.status(400).json({ success: false, message: 'Aucun module transféré pour ce semestre.' });
        }
        const annee = annee_academique || '';
        let lignes = 0;
        const aNotifier = [];
        for (const e of etudiants) {
            const mods = Object.entries(e.modules);
            if (!mods.length) continue;
            for (const [moduleId, v] of mods) {
                await pool.query(
                    `INSERT INTO moyennes_provisoires (etudiant_id, module_id, filiere_id, niveau, semestre, annee_academique, moyenne, nb_devoirs, publie_le)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                     ON CONFLICT (etudiant_id, module_id, semestre, annee_academique)
                     DO UPDATE SET moyenne = EXCLUDED.moyenne, nb_devoirs = EXCLUDED.nb_devoirs, publie_le = NOW()`,
                    [e.etudiant_id, moduleId, filiere_id, niveau, semestre, annee, v.moyenne, v.devoirs.length]);
                lignes++;
            }
            aNotifier.push(e.etudiant_id);
        }
        res.json({ success: true, etudiants: aNotifier.length, lignes,
                   message: `Moyennes provisoires envoyées à ${aNotifier.length} étudiant(s).` });

        (async () => {
            for (const id of aNotifier) {
                try {
                    const u = await pool.query('SELECT user_id FROM etudiants WHERE id = $1', [id]);
                    const uid = u.rows[0]?.user_id;
                    if (uid) await envoyerNotificationAuto(uid, 'Moyennes provisoires disponibles',
                        `Tes moyennes provisoires par module du ${semestre} sont disponibles.`, 'note', null);
                } catch (err) { console.error('[publierMoyennesProvisoires] notif', err.message); }
            }
        })();
    } catch (e) {
        console.error('[publierMoyennesProvisoires]', e);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Erreur lors de la publication.' });
    }
};

// GET /notes/moyennes-provisoires/mes  (étudiant connecté — uniquement SES moyennes)
const mesMoyennesProvisoires = async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT mp.semestre, mp.annee_academique, mp.moyenne, mp.nb_devoirs, mp.publie_le,
                    m.id AS module_id, m.nom AS module_nom, m.coefficient
             FROM moyennes_provisoires mp
             JOIN etudiants e ON e.id = mp.etudiant_id
             JOIN modules m ON m.id = mp.module_id
             WHERE e.user_id = $1
             ORDER BY mp.semestre, m.nom`, [req.user.id]);
        res.json({ success: true, data: r.rows });
    } catch (e) {
        console.error('[mesMoyennesProvisoires]', e);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des moyennes provisoires.' });
    }
};

module.exports = {
    stockerSessions, transfererSessions, archiverSessions,
    apercuMoyennesProvisoires, publierMoyennesProvisoires, mesMoyennesProvisoires,
};
