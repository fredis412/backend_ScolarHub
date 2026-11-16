const pool = require('../config/db');

// ── Bonus de participation ──────────────────────────────────────────────────
// Un professeur attribue des bonus (+0,25 / +0,5 / +1 / +2 ...) à un étudiant
// pendant le cours, pour un module. Tant qu'un bonus n'a pas été « consommé »
// par une session de notes (session_id NULL), il s'ajoute à la prochaine note
// saisie pour ce module (voir createGradeSession, option appliquer_bonus).

const peutGerer = (req) => /prof|admin/i.test(String(req.user?.role || ''));

const arrondi2 = (v) => Math.round(v * 100) / 100;

// Le module doit appartenir à une filière de l'établissement de l'utilisateur
// (req.etablissementId absent = anciens jetons, pas de filtre).
async function moduleAutorise(moduleId, etabId) {
    const r = await pool.query('SELECT filiere_id FROM modules WHERE id = $1', [moduleId]);
    if (r.rows.length === 0) return false;
    if (!etabId) return true;
    const f = await pool.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [r.rows[0].filiere_id, etabId]);
    return f.rows.length > 0;
}

// POST /api/bonus  { module_id, matricule, valeur, motif? }
const ajouterBonus = async (req, res) => {
    try {
        if (!peutGerer(req)) return res.status(403).json({ success: false, message: 'Accès refusé.' });
        const { module_id, matricule, motif } = req.body;
        const valeur = Number(String(req.body.valeur ?? '').trim().replace(',', '.'));
        if (!module_id || !matricule) {
            return res.status(400).json({ success: false, message: 'module_id et matricule sont requis.' });
        }
        if (!Number.isFinite(valeur) || valeur <= 0 || valeur > 20) {
            return res.status(400).json({ success: false, message: 'Le bonus doit être un nombre entre 0,01 et 20.' });
        }
        if (!(await moduleAutorise(module_id, req.etablissementId))) {
            return res.status(404).json({ success: false, message: 'Module introuvable.' });
        }

        const pe = [matricule];
        let filtreEtu = '';
        if (req.etablissementId) {
            pe.push(req.etablissementId);
            filtreEtu = ` AND etablissement_id = $${pe.length}`;
        }
        const etu = await pool.query(`SELECT id FROM etudiants WHERE matricule = $1${filtreEtu}`, pe);
        if (etu.rows.length === 0) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });

        const ins = await pool.query(
            `INSERT INTO bonus_etudiants (etudiant_id, module_id, professeur_id, valeur, motif)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [etu.rows[0].id, module_id, req.user.id, arrondi2(valeur), (motif || '').toString().trim().slice(0, 255) || null]
        );
        res.status(201).json({ success: true, id: ins.rows[0].id });
    } catch (error) {
        console.error('[ajouterBonus]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'ajout du bonus.' });
    }
};

// GET /api/bonus/module/:moduleId → { matricule: { total, items: [...] } }
// (bonus pas encore appliqués à une note)
const getBonusModule = async (req, res) => {
    try {
        if (!peutGerer(req)) return res.status(403).json({ success: false, message: 'Accès refusé.' });
        const { moduleId } = req.params;
        if (!(await moduleAutorise(moduleId, req.etablissementId))) {
            return res.status(404).json({ success: false, message: 'Module introuvable.' });
        }
        const r = await pool.query(
            `SELECT b.id, b.valeur, b.motif, b.created_at, e.matricule
             FROM bonus_etudiants b
             JOIN etudiants e ON e.id = b.etudiant_id
             WHERE b.module_id = $1 AND b.session_id IS NULL
             ORDER BY b.created_at DESC`,
            [moduleId]
        );
        const data = {};
        for (const row of r.rows) {
            const d = (data[row.matricule] ??= { total: 0, items: [] });
            const v = parseFloat(row.valeur) || 0;
            d.total = arrondi2(d.total + v);
            d.items.push({ id: row.id, valeur: v, motif: row.motif, created_at: row.created_at });
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error('[getBonusModule]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des bonus.' });
    }
};

// DELETE /api/bonus/:id — seulement un bonus pas encore appliqué, par son auteur (ou un admin)
const supprimerBonus = async (req, res) => {
    try {
        if (!peutGerer(req)) return res.status(403).json({ success: false, message: 'Accès refusé.' });
        const r = await pool.query('SELECT professeur_id, module_id, session_id FROM bonus_etudiants WHERE id = $1', [req.params.id]);
        const b = r.rows[0];
        if (!b || !(await moduleAutorise(b.module_id, req.etablissementId))) {
            return res.status(404).json({ success: false, message: 'Bonus introuvable.' });
        }
        if (b.session_id) {
            return res.status(400).json({ success: false, message: 'Ce bonus a déjà été ajouté à une note.' });
        }
        if (String(b.professeur_id) !== String(req.user.id) && !/admin/i.test(String(req.user.role || ''))) {
            return res.status(403).json({ success: false, message: 'Accès refusé.' });
        }
        await pool.query('DELETE FROM bonus_etudiants WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('[supprimerBonus]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la suppression du bonus.' });
    }
};

module.exports = { ajouterBonus, getBonusModule, supprimerBonus };
