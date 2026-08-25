const PDFDocument = require('pdfkit');
const pool = require('../config/db');

const getNotesEtudiant = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(`
            SELECT n.id, n.valeur AS note, m.nom AS module_nom, m.coefficient
            FROM notes n
            JOIN modules m ON n.module_id = m.id
            JOIN etudiants e ON n.etudiant_id = e.id
            WHERE e.user_id = $1
            ORDER BY m.nom
        `, [userId]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('[getNotesEtudiant]', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement des notes.' });
    }
};

const generateBulletinPdf = async (req, res) => {
    try {
        const etudiantId = req.params.etudiantId;

        // Fetch student details
        const studentQuery = `SELECT nom, prenoms, matricule FROM users WHERE id = $1 AND role = 'etudiant'`;
        const studentResult = await pool.query(studentQuery, [etudiantId]);
        
        if (studentResult.rows.length === 0) {
            return res.status(404).json({ error: "Étudiant non trouvé." });
        }
        
        const etudiant = studentResult.rows[0];

        // Fetch notes
        const notesQuery = `
            SELECT m.nom AS matiere, m.coefficient, n.valeur AS note
            FROM notes n
            JOIN modules m ON n.module_id = m.id
            JOIN etudiants e ON n.etudiant_id = e.id
            WHERE e.user_id = $1
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
        const { filiere_id, filiere_nom, niveau, module_id, notes, statut } = req.body;
        const professeur_id = req.user.id;
        const statutFinal = statut === 'validee' ? 'validee' : 'en_attente';

        if (!filiere_id || !module_id) {
            return res.status(400).json({ success: false, message: 'filiere_id et module_id sont requis.' });
        }

        const sessionResult = await pool.query(`
            INSERT INTO sessions_notes (filiere_id, filiere_nom, niveau, module_id, professeur_id, statut, is_sent)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `, [filiere_id, filiere_nom || '', niveau || 'Tous', module_id, professeur_id, statutFinal, statutFinal === 'validee']);

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
                   sn.date_session, sn.statut, sn.is_sent,
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
            LEFT JOIN notes n ON n.session_id = sn.id
            LEFT JOIN etudiants e ON n.etudiant_id = e.id
            ${where}
            GROUP BY sn.id, m.nom, m.coefficient, u.nom, u.prenoms
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
const getMoyennesAdmin = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.id AS etudiant_id, e.matricule, e.nom, e.prenoms,
                   COALESCE(e.filiere_nom, f.nom) AS filiere_nom, e.niveau,
                   ROUND(SUM(n.valeur * m.coefficient) / NULLIF(SUM(m.coefficient), 0), 2) AS moyenne,
                   COUNT(n.id) AS nb_notes
            FROM notes n
            JOIN modules m ON n.module_id = m.id
            JOIN etudiants e ON n.etudiant_id = e.id
            JOIN sessions_notes sn ON n.session_id = sn.id
            LEFT JOIN filieres f ON f.id = e.filiere_id
            WHERE sn.statut = 'validee'
            GROUP BY e.id, e.matricule, e.nom, e.prenoms, e.filiere_nom, f.nom, e.niveau
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
    getMoyennesAdmin
};
