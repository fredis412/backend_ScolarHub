const pool = require('../config/db');

// ════════════════════════════════════════════════════════════════════════════
// BULLETINS — publication de la moyenne générale du semestre
// ════════════════════════════════════════════════════════════════════════════
//
// Flux :
// 1. L'admin ouvre "Préparer le bulletin" pour une filière + niveau + semestre
//    + année académique → getPreparationBulletin calcule automatiquement la
//    moyenne générale de chaque étudiant à partir de ses notes déjà validées.
// 2. L'admin coche manuellement Validé / Ajourné / Invalidé pour CHAQUE
//    étudiant (jamais calculé automatiquement par seuil).
// 3. Au clic "Publier", publierBulletins crée/actualise les lignes de la
//    table bulletins avec publie = true — c'est SEULEMENT à ce moment que
//    l'étudiant peut voir sa moyenne générale et son statut dans l'app.
// 4. getMonBulletin (étudiant) ne renvoie QUE les bulletins publie = true de
//    l'étudiant connecté — jamais de brouillon, jamais celui d'un autre.

// GET /api/bulletins/preparation?filiere_id=&niveau=&semestre=&annee_academique=
const getPreparationBulletin = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique } = req.query;
        if (!filiere_id || !niveau || !semestre || !annee_academique) {
            return res.status(400).json({
                success: false,
                message: 'filiere_id, niveau, semestre et annee_academique sont requis.',
            });
        }

        const result = await pool.query(`
            SELECT
                e.id AS etudiant_id, e.matricule, e.nom, e.prenoms,
                COALESCE(e.filiere_nom, f.nom) AS filiere_nom, e.niveau,
                ROUND(SUM(n.valeur * m.coefficient) / NULLIF(SUM(m.coefficient), 0), 2) AS moyenne_calculee,
                COUNT(n.id) AS nb_notes,
                b.id AS bulletin_id,
                b.statut AS bulletin_statut,
                b.publie AS bulletin_publie,
                b.date_publication
            FROM etudiants e
            LEFT JOIN filieres f ON f.id = e.filiere_id
            JOIN notes n ON n.etudiant_id = e.id
            JOIN sessions_notes sn ON n.session_id = sn.id
                AND sn.statut = 'validee'
                AND sn.semestre = $3
                AND sn.annee_academique = $4
            JOIN modules m ON n.module_id = m.id
            LEFT JOIN bulletins b ON b.etudiant_id = e.id
                AND b.semestre = $3
                AND b.annee_academique = $4
            WHERE e.filiere_id = $1 AND e.niveau = $2
            GROUP BY e.id, e.matricule, e.nom, e.prenoms, e.filiere_nom, f.nom, e.niveau,
                     b.id, b.statut, b.publie, b.date_publication
            ORDER BY e.nom
        `, [filiere_id, niveau, semestre, annee_academique]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('[getPreparationBulletin]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul des moyennes.' });
    }
};

// POST /api/bulletins/publier (admin)
// Body : { filiere_id, niveau, semestre, annee_academique,
//          resultats: [{ etudiant_id, statut }] }
//
// ✅ CORRIGÉ — bug bloquant trouvé : le mécanisme de requêtes de ce backend
// passe par une fonction RPC PostgreSQL (execute_sql) qui exécute du SQL
// dynamique via EXECUTE — et PostgreSQL interdit de piloter des commandes
// de transaction (BEGIN/COMMIT/ROLLBACK) depuis du SQL dynamique exécuté
// à l'intérieur d'une fonction. L'ancienne version utilisait client.query
// ('BEGIN')/'COMMIT'/'ROLLBACK', ce qui échouait systématiquement avec
// "EXECUTE of transaction commands is not implemented" — la publication
// restait bloquée indéfiniment côté Flutter (aucune réponse ne revenait
// jamais, juste un rejet de promesse non intercepté côté serveur).
//
// Solution : publication étudiant par étudiant, chaque upsert restant
// atomique individuellement (un seul INSERT ... ON CONFLICT ne peut pas
// être "à moitié" appliqué). On perd la garantie "tout ou rien" pour le
// groupe entier — compromis nécessaire vu que cette architecture RPC ne
// permet pas de vraies transactions multi-requêtes. Les échecs partiels
// sont rapportés individuellement dans la réponse (voir "echecs" ci-dessous).
const publierBulletins = async (req, res) => {
    try {
        const { filiere_id, niveau, semestre, annee_academique, resultats } = req.body;
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

        const publies = [];
        const echecs = [];

        for (const r of resultats) {
            try {
                // Moyenne recalculée côté serveur au moment de la publication —
                // jamais confiée au client, pour éviter toute manipulation.
                const moyResult = await pool.query(`
                    SELECT ROUND(SUM(n.valeur * m.coefficient) / NULLIF(SUM(m.coefficient), 0), 2) AS moyenne
                    FROM notes n
                    JOIN sessions_notes sn ON n.session_id = sn.id
                        AND sn.statut = 'validee'
                        AND sn.semestre = $2
                        AND sn.annee_academique = $3
                    JOIN modules m ON n.module_id = m.id
                    WHERE n.etudiant_id = $1
                `, [r.etudiant_id, semestre, annee_academique]);

                const moyenne = moyResult.rows[0]?.moyenne ?? null;

                const upsert = await pool.query(`
                    INSERT INTO bulletins (
                        etudiant_id, filiere_id, niveau, semestre, annee_academique,
                        moyenne_generale, statut, publie, admin_id, date_publication
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, now())
                    ON CONFLICT (etudiant_id, semestre, annee_academique)
                    DO UPDATE SET
                        moyenne_generale = EXCLUDED.moyenne_generale,
                        statut = EXCLUDED.statut,
                        publie = true,
                        admin_id = EXCLUDED.admin_id,
                        date_publication = now()
                    RETURNING id, etudiant_id, moyenne_generale, statut
                `, [r.etudiant_id, filiere_id, niveau, semestre, annee_academique, moyenne, r.statut, admin_id]);

                if (upsert.rows[0]) {
                    publies.push(upsert.rows[0]);
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
                ? `${publies.length} bulletin(s) publié(s).`
                : `${publies.length} bulletin(s) publié(s), ${echecs.length} échec(s).`,
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

        // Renvoie aussi nom/prenoms/filiere_nom/niveau — évite à
        // bulletin_screen.dart (Flutter) d'avoir à interroger Supabase
        // directement pour ces infos (contournait RLS, bloqué en silence
        // pour la clé publique — voir diagnostic du 29/08).
        const etudiantResult = await pool.query(
            `SELECT id, nom, prenoms, filiere_nom, niveau FROM etudiants WHERE user_id = $1`,
            [userId]
        );
        const etudiant = etudiantResult.rows[0];
        if (!etudiant) {
            return res.status(404).json({ success: false, message: 'Profil étudiant introuvable.' });
        }

        const result = await pool.query(`
            SELECT id, semestre, annee_academique, moyenne_generale, statut, date_publication
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

module.exports = {
    getPreparationBulletin,
    publierBulletins,
    getMonBulletin,
};
