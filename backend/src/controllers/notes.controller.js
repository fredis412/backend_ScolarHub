const PDFDocument = require('pdfkit');
const pool = require('../config/db');

const getNotesEtudiant = async (req, res) => {
    try {
        const userId = req.user.id;
        const { semestre, annee_academique } = req.query;

        const params = [userId];
        let filtreSemestre = '';
        if (semestre) {
            params.push(semestre);
            filtreSemestre += ` AND sn.semestre = $${params.length}`;
        }
        if (annee_academique) {
            params.push(annee_academique);
            filtreSemestre += ` AND sn.annee_academique = $${params.length}`;
        }

        // Ne renvoie que les notes des sessions validées par l'administration
        // (sn.statut = 'validee'), et toujours filtrées par l'étudiant
        // connecté (e.user_id = req.user.id, via le JWT) — jamais celles
        // d'un autre étudiant. Filtre semestre/annee_academique optionnel,
        // utilisé par bulletin_screen.dart pour afficher le détail des
        // modules d'un semestre publié précis.
        // ✅ Ajout de prof_nom/prof_prenoms/date_session — nécessaires pour
        // remplacer entièrement vue_notes_etudiants (RLS bloquée) côté
        // notes_tab.dart étudiant, sans rien perdre à l'affichage.
        const result = await pool.query(`
            SELECT n.id, n.valeur AS note, m.nom AS module_nom, m.coefficient,
                   sn.date_session, u.nom AS prof_nom, u.prenoms AS prof_prenoms
            FROM notes n
            JOIN modules m ON n.module_id = m.id
            JOIN etudiants e ON n.etudiant_id = e.id
            JOIN sessions_notes sn ON n.session_id = sn.id
            LEFT JOIN users u ON sn.professeur_id = u.id
            WHERE e.user_id = $1 AND sn.statut = 'validee'${filtreSemestre}
            ORDER BY m.nom
        `, params);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('[getNotesEtudiant]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des notes.' });
    }
};

const generateBulletinPdf = async (req, res) => {
    try {
        const etudiantId = req.params.etudiantId;

        // ✅ CORRIGÉ (sécurité) : sans ce contrôle, n'importe quel utilisateur
        // connecté pouvait télécharger le bulletin de n'importe quel autre
        // étudiant en changeant l'id dans l'URL. Seul l'étudiant concerné
        // (req.user.id === etudiantId) ou un admin peut générer ce bulletin.
        if (req.user.role !== 'admin' && req.user.id !== etudiantId) {
            return res.status(403).json({ error: "Accès refusé : vous ne pouvez générer que votre propre bulletin." });
        }

        // Fetch student details
        const studentQuery = `SELECT nom, prenoms, matricule FROM users WHERE id = $1 AND (role ILIKE '%etudiant%' OR role ILIKE '%delegue%' OR role ILIKE '%bde%')`;
        const studentResult = await pool.query(studentQuery, [etudiantId]);

        if (studentResult.rows.length === 0) {
            return res.status(404).json({ error: "Étudiant non trouvé." });
        }

        const etudiant = studentResult.rows[0];

        // Fetch notes
        // ✅ CORRIGÉ : n'inclut désormais que les notes des sessions
        // validées par l'administration (sn.statut = 'validee'). Avant,
        // un étudiant pouvait recevoir un bulletin incluant des notes
        // jamais publiées.
        const notesQuery = `
            SELECT m.nom AS matiere, m.coefficient, n.valeur AS note
            FROM notes n
            JOIN modules m ON n.module_id = m.id
            JOIN etudiants e ON n.etudiant_id = e.id
            JOIN sessions_notes sn ON n.session_id = sn.id
            WHERE e.user_id = $1 AND sn.statut = 'validee'
        `;

        const notesResult = await pool.query(notesQuery, [etudiantId]);
        const notes = notesResult.rows;

        // Create PDF
        const doc = new PDFDocument({ margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=bulletin_${etudiant.matricule}.pdf`);

        doc.pipe(res);

        // Header
        doc.fontSize(20).text('ScolarHub - Bulletin de Notes', { align: 'center' });
        doc.moveDown();

        doc.fontSize(14).text(`Étudiant: ${etudiant.prenoms} ${etudiant.nom}`);
        doc.text(`Matricule: ${etudiant.matricule}`);
        doc.moveDown(2);

        // Table headers
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('Matière', 50, doc.y);
        doc.text('Coef', 300, doc.y - doc.currentLineHeight());
        doc.text('Note', 400, doc.y - doc.currentLineHeight());

        let currentY = doc.y + 5;
        doc.moveTo(50, currentY).lineTo(450, currentY).stroke();
        currentY += 15;

        doc.font('Helvetica');
        let sumNotes = 0;
        let sumCoefs = 0;

        for (const row of notes) {
            let noteVal = parseFloat(row.note);
            let coefVal = parseFloat(row.coefficient);
            if (isNaN(noteVal)) noteVal = 0;
            if (isNaN(coefVal)) coefVal = 1;

            sumNotes += noteVal * coefVal;
            sumCoefs += coefVal;

            doc.text(row.matiere, 50, currentY, { width: 240 });
            doc.text(coefVal.toString(), 300, currentY);
            doc.text(noteVal.toFixed(2) + ' / 20', 400, currentY);

            currentY += 25;
        }

        currentY += 10;
        doc.moveTo(50, currentY).lineTo(450, currentY).stroke();
        currentY += 20;

        let moyenneGenerale = sumCoefs > 0 ? (sumNotes / sumCoefs) : 0;

        // ⚠️ TODO(business) : la mention de la moyenne GÉNÉRALE (bulletin)
        // doit utiliser Validé/Ajourné/Invalidé, pas Très Bien/Bien/...
        // (ces dernières s'appliquent aux notes/moyennes de CHAQUE module,
        // pas à la moyenne générale). En attente des seuils exacts
        // (ex. Validé >= 10 ? Ajourné entre X et 10 ? Invalidé < Y ?)
        // avant de remplacer la ligne ci-dessous.
        let mention = "Passable";
        if (moyenneGenerale >= 16) mention = "Très Bien";
        else if (moyenneGenerale >= 14) mention = "Bien";
        else if (moyenneGenerale >= 12) mention = "Assez Bien";
        else if (moyenneGenerale < 10) mention = "Insuffisant";

        doc.font('Helvetica-Bold').fontSize(14);
        doc.text(`Moyenne Générale : ${moyenneGenerale.toFixed(2)} / 20`, 50, currentY);
        currentY += 20;
        doc.text(`Mention : ${mention}`, 50, currentY);

        doc.end();

    } catch (error) {
        console.error('Erreur génération PDF:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erreur interne du serveur lors de la génération du bulletin.' });
        }
    }
};

const createGradeSession = async (req, res) => {
    try {
        const { filiere_id, filiere_nom, niveau, module_id, notes, statut, mention, semestre, annee_academique } = req.body;
        const professeur_id = req.user.id;
        const statutFinal = statut === 'validee' ? 'validee' : 'en_attente';

        if (!filiere_id || !module_id) {
            return res.status(400).json({ success: false, message: 'filiere_id et module_id sont requis.' });
        }
        if (!semestre || !annee_academique) {
            return res.status(400).json({ success: false, message: 'semestre et annee_academique sont requis.' });
        }

        // La mention (Très Bien/Bien/Assez Bien/Passable/Insuffisant) est
        // choisie par le professeur pour l'ensemble de la session — elle
        // qualifie la performance globale de la classe sur ce module, pas
        // une note individuelle. semestre/annee_academique sont requis pour
        // que la préparation du bulletin (moyenne générale du semestre)
        // puisse retrouver les bonnes notes.
        const sessionResult = await pool.query(`
            INSERT INTO sessions_notes (filiere_id, filiere_nom, niveau, module_id, professeur_id, statut, is_sent, mention, semestre, annee_academique)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
        `, [filiere_id, filiere_nom || '', niveau || 'Tous', module_id, professeur_id, statutFinal, statutFinal === 'validee', mention || null, semestre, annee_academique]);

        const session_id = sessionResult.rows[0].id;
        const skippedStudents = [];

        if (notes && notes.length > 0) {
            for (const note of notes) {
                if (!note.matricule || note.valeur === undefined || note.valeur === null) {
                    skippedStudents.push({ matricule: note.matricule || 'inconnu', reason: 'matricule ou valeur manquant' });
                    continue;
                }
                const etudiantResult = await pool.query(`SELECT id FROM etudiants WHERE matricule = $1`, [note.matricule]);
                if (etudiantResult.rows.length > 0) {
                    const e_id = etudiantResult.rows[0].id;
                    await pool.query(`
                        INSERT INTO notes (etudiant_id, module_id, session_id, valeur)
                        VALUES ($1, $2, $3, $4)
                    `, [e_id, module_id, session_id, note.valeur]);
                } else {
                    skippedStudents.push({ matricule: note.matricule, reason: 'étudiant introuvable' });
                }
            }
        }

        const response = { success: true, message: 'Session de notes créée avec succès', session_id };
        if (skippedStudents.length > 0) {
            response.warnings = skippedStudents;
            response.message = `Session créée avec ${skippedStudents.length} note(s) non enregistrée(s).`;
        }
        res.status(201).json(response);
    } catch (error) {
        console.error('[createGradeSession]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la création de la session de notes.' });
    }
};

// GET /api/notes/sessions/admin/all - Toutes les sessions (admin), avec notes détaillées
// ✅ CORRIGÉ : jointure vers filieres ajoutée pour exposer le vrai champ
// domaine (au lieu de laisser le Flutter deviner via le nom de la filière).
const getAllSessionsAdmin = async (req, res) => {
    try {
        const { statut } = req.query;
        const params = [];
        let where = '';
        if (statut) {
            params.push(statut);
            where = `WHERE sn.statut = $${params.length}`;
        }

        const result = await pool.query(`
            SELECT sn.id, sn.filiere_id, sn.filiere_nom, sn.niveau, sn.module_id,
                   m.nom AS module_nom, m.coefficient,
                   sn.professeur_id, u.nom AS prof_nom, u.prenoms AS prof_prenoms,
                   sn.date_session, sn.statut, sn.is_sent, sn.mention,
                   f.domaine AS domaine,
                   COALESCE(
                     json_agg(
                       json_build_object(
                         'note_id', n.id, 'matricule', e.matricule,
                         'nom', e.nom, 'prenoms', e.prenoms, 'valeur', n.valeur
                       )
                     ) FILTER (WHERE n.id IS NOT NULL), '[]'
                   ) AS notes
            FROM sessions_notes sn
            JOIN modules m ON sn.module_id = m.id
            JOIN users u ON sn.professeur_id = u.id
            LEFT JOIN filieres f ON f.id = sn.filiere_id
            LEFT JOIN notes n ON n.session_id = sn.id
            LEFT JOIN etudiants e ON n.etudiant_id = e.id
            ${where}
            GROUP BY sn.id, m.nom, m.coefficient, u.nom, u.prenoms, f.domaine
            ORDER BY sn.date_session DESC
        `, params);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('[getAllSessionsAdmin]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des sessions.' });
    }
};

// PATCH /api/notes/sessions/:session_id/valider - Valider et envoyer aux étudiants (admin)
const validateSessionAdmin = async (req, res) => {
    try {
        const { session_id } = req.params;
        const result = await pool.query(`
            UPDATE sessions_notes SET statut = 'validee', is_sent = true
            WHERE id = $1 RETURNING id
        `, [session_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Session non trouvée.' });
        }
        res.json({ success: true, message: 'Session validée et envoyée aux étudiants.' });
    } catch (error) {
        console.error('[validateSessionAdmin]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la validation.' });
    }
};

// PATCH /api/notes/sessions/:session_id/rejeter - Rejeter une session (admin)
const rejectSessionAdmin = async (req, res) => {
    try {
        const { session_id } = req.params;
        const { motif } = req.body;
        const result = await pool.query(`
            UPDATE sessions_notes SET statut = 'rejetee', is_sent = false, motif_rejet = $2
            WHERE id = $1 RETURNING id
        `, [session_id, motif?.trim() || null]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Session non trouvée.' });
        }
        res.json({ success: true, message: 'Session rejetée.' });
    } catch (error) {
        console.error('[rejectSessionAdmin]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du rejet.' });
    }
};

// GET /api/notes/sessions/:session_id - Détail d'une session (professeur propriétaire)
const getSessionDetail = async (req, res) => {
    try {
        const { session_id } = req.params;
        const professeur_id = req.user.id;

        const sessionResult = await pool.query(`
            SELECT sn.*, m.nom AS module_nom
            FROM sessions_notes sn
            JOIN modules m ON sn.module_id = m.id
            WHERE sn.id = $1
        `, [session_id]);

        const session = sessionResult.rows[0];
        if (!session) return res.status(404).json({ success: false, message: 'Session non trouvée.' });
        if (session.professeur_id !== professeur_id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Accès refusé.' });
        }

        const notesResult = await pool.query(`
            SELECT n.id AS note_id, n.valeur, e.matricule, e.nom, e.prenoms
            FROM notes n
            JOIN etudiants e ON n.etudiant_id = e.id
            WHERE n.session_id = $1
            ORDER BY e.nom
        `, [session_id]);

        res.json({ success: true, data: { ...session, notes: notesResult.rows } });
    } catch (error) {
        console.error('[getSessionDetail]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement de la session.' });
    }
};

// PUT /api/notes/sessions/:session_id - Modifier les notes d'une session rejetée puis la retransmettre
const updateGradeSession = async (req, res) => {
    try {
        const { session_id } = req.params;
        const { notes } = req.body;
        const professeur_id = req.user.id;

        const sessionResult = await pool.query(`SELECT * FROM sessions_notes WHERE id = $1`, [session_id]);
        const session = sessionResult.rows[0];
        if (!session) return res.status(404).json({ success: false, message: 'Session non trouvée.' });
        if (session.professeur_id !== professeur_id) {
            return res.status(403).json({ success: false, message: 'Accès refusé.' });
        }

        if (notes && notes.length > 0) {
            for (const note of notes) {
                if (!note.matricule || note.valeur === undefined || note.valeur === null) continue;
                const etudiantResult = await pool.query(`SELECT id FROM etudiants WHERE matricule = $1`, [note.matricule]);
                const e_id = etudiantResult.rows[0]?.id;
                if (!e_id) continue;

                const existing = await pool.query(
                    `SELECT id FROM notes WHERE session_id = $1 AND etudiant_id = $2`,
                    [session_id, e_id]
                );
                if (existing.rows.length > 0) {
                    await pool.query(`UPDATE notes SET valeur = $1 WHERE id = $2`, [note.valeur, existing.rows[0].id]);
                } else {
                    await pool.query(
                        `INSERT INTO notes (etudiant_id, module_id, session_id, valeur) VALUES ($1, $2, $3, $4)`,
                        [e_id, session.module_id, session_id, note.valeur]
                    );
                }
            }
        }

        await pool.query(`
            UPDATE sessions_notes SET statut = 'en_attente', is_sent = false, motif_rejet = NULL
            WHERE id = $1
        `, [session_id]);

        res.json({ success: true, message: 'Session mise à jour et retransmise pour validation.' });
    } catch (error) {
        console.error('[updateGradeSession]', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de la session.' });
    }
};

// GET /api/notes/moyennes - Moyennes générales de tous les étudiants (admin), basées sur les notes validées
// ✅ CORRIGÉ : ajout de f.domaine dans le SELECT et le GROUP BY.
const getMoyennesAdmin = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.id AS etudiant_id, e.matricule, e.nom, e.prenoms,
                   COALESCE(e.filiere_nom, f.nom) AS filiere_nom, e.niveau,
                   f.domaine AS domaine,
                   ROUND(SUM(n.valeur * m.coefficient) / NULLIF(SUM(m.coefficient), 0), 2) AS moyenne,
                   COUNT(n.id) AS nb_notes
            FROM notes n
            JOIN modules m ON n.module_id = m.id
            JOIN etudiants e ON n.etudiant_id = e.id
            JOIN sessions_notes sn ON n.session_id = sn.id
            LEFT JOIN filieres f ON f.id = e.filiere_id
            WHERE sn.statut = 'validee'
            GROUP BY e.id, e.matricule, e.nom, e.prenoms, e.filiere_nom, f.nom, f.domaine, e.niveau
            HAVING SUM(m.coefficient) > 0
            ORDER BY moyenne DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('[getMoyennesAdmin]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul des moyennes.' });
    }
};

const getGradeSessions = async (req, res) => {
    try {
        const professeur_id = req.user.id;
        const result = await pool.query(`
            SELECT sn.*, m.nom as module_nom 
            FROM sessions_notes sn
            JOIN modules m ON sn.module_id = m.id
            WHERE sn.professeur_id = $1
            ORDER BY sn.date_session DESC
        `, [professeur_id]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const markSessionSent = async (req, res) => {
    try {
        const { session_id } = req.params;
        const professeur_id = req.user.id;

        await pool.query(`
            UPDATE sessions_notes SET is_sent = true 
            WHERE id = $1 AND professeur_id = $2
        `, [session_id, professeur_id]);

        res.json({ success: true, message: 'Session marquée comme envoyée' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// GET /api/notes/mon-apercu (étudiant connecté)
// ✅ NOUVEAU — remplace les requêtes Supabase directes de home_tab.dart
// (moyenne + taux de présence), bloquées silencieusement par RLS activé
// sans politique sur `etudiants`/`notes`/`sessions_notes` (découvert le
// 03/09 : relrowsecurity = true sur la quasi-totalité des tables). Toujours
// scopé par req.user.id (JWT) — jamais les données d'un autre étudiant.
const getMonApercu = async (req, res) => {
    try {
        const userId = req.user.id;

        const etudiantResult = await pool.query(
            `SELECT id FROM etudiants WHERE user_id = $1`,
            [userId]
        );
        const etudiant = etudiantResult.rows[0];
        if (!etudiant) {
            return res.status(404).json({ success: false, message: 'Profil étudiant introuvable.' });
        }

        // Moyenne pondérée par coefficient, toutes notes validées confondues
        // (pas de filtre semestre — reflète l'ensemble de l'année en cours,
        // cohérent avec l'ancien calcul client-side qu'on remplace).
        const notesResult = await pool.query(`
            SELECT n.valeur, m.coefficient
            FROM notes n
            JOIN modules m ON n.module_id = m.id
            JOIN sessions_notes sn ON n.session_id = sn.id AND sn.statut = 'validee'
            WHERE n.etudiant_id = $1
        `, [etudiant.id]);

        let moyenne = null;
        if (notesResult.rows.length > 0) {
            let sommePonderee = 0;
            let sommeCoef = 0;
            for (const n of notesResult.rows) {
                sommePonderee += Number(n.valeur) * Number(n.coefficient);
                sommeCoef += Number(n.coefficient);
            }
            if (sommeCoef > 0) moyenne = Math.round((sommePonderee / sommeCoef) * 100) / 100;
        }

        // Taux de présence via la vue vue_presences_etudiants (déjà utilisée
        // ailleurs dans le projet).
        const presResult = await pool.query(`
            SELECT presence_statut FROM vue_presences_etudiants WHERE etudiant_id = $1
        `, [etudiant.id]);

        let tauxPresence = null;
        if (presResult.rows.length > 0) {
            const presents = presResult.rows.filter(p => p.presence_statut === 'present').length;
            tauxPresence = Math.round((presents / presResult.rows.length) * 10000) / 100;
        }

        res.json({ success: true, data: { moyenne, tauxPresence } });
    } catch (error) {
        console.error('[getMonApercu]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul de l\'aperçu.' });
    }
};

module.exports = {
    getNotesEtudiant,
    generateBulletinPdf,
    createGradeSession,
    getGradeSessions,
    getSessionDetail,
    updateGradeSession,
    markSessionSent,
    getAllSessionsAdmin,
    validateSessionAdmin,
    rejectSessionAdmin,
    getMoyennesAdmin,
    getMonApercu,
};
