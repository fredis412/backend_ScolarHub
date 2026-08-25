const crypto = require('crypto');
const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');
const { envoyerSMS } = require('../services/sms.service');

const DUREE_SESSION_MIN = 10; // durée de validité d'une session de check-in

const genererCode = () => String(Math.floor(100000 + Math.random() * 900000));

// POST /api/appels/qr - Le prof ouvre une session d'appel par QR/code (prof)
const ouvrirSessionQr = async (req, res) => {
  try {
    const { filiere_id, filiere_nom, niveau, module_id } = req.body;
    const professeur_id = req.user.id;
    if (!filiere_id || !module_id) {
      return res.status(400).json({ success: false, message: 'filiere_id et module_id sont requis.' });
    }

    const appelResult = await pool.query(`
      INSERT INTO appels (filiere_id, filiere_nom, niveau, module_id, professeur_id)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [filiere_id, filiere_nom || '', niveau || 'Tous', module_id, professeur_id]);
    const appel_id = appelResult.rows[0].id;

    const code = genererCode();
    const token = crypto.randomUUID();
    const sessionResult = await pool.query(`
      INSERT INTO appel_qr_sessions (appel_id, code, token, expires_at, statut)
      VALUES ($1, $2, $3, NOW() + INTERVAL '${DUREE_SESSION_MIN} minutes', 'ouverte')
      RETURNING id, expires_at
    `, [appel_id, code, token]);

    res.status(201).json({
      success: true,
      session_id: sessionResult.rows[0].id,
      appel_id,
      code,
      token,
      expires_at: sessionResult.rows[0].expires_at,
      duree_minutes: DUREE_SESSION_MIN,
    });
  } catch (error) {
    console.error('[ouvrirSessionQr]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'ouverture de la session.' });
  }
};

// GET /api/appels/qr/:sessionId - État de la session (prof, pour suivi en direct)
const getSessionQr = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionResult = await pool.query(`
      SELECT s.*, a.filiere_id, a.filiere_nom, a.professeur_id
      FROM appel_qr_sessions s
      JOIN appels a ON a.id = s.appel_id
      WHERE s.id = $1
    `, [sessionId]);
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ success: false, message: 'Session non trouvée.' });
    if (session.professeur_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }

    const presencesResult = await pool.query(`
      SELECT matricule, nom, prenoms, statut FROM appel_presences
      WHERE appel_id = $1 ORDER BY nom
    `, [session.appel_id]);

    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total FROM etudiants WHERE filiere_id = $1 AND (statut = 'actif' OR statut IS NULL)`,
      [session.filiere_id],
    );

    res.json({
      success: true,
      data: {
        session_id: session.id,
        appel_id: session.appel_id,
        code: session.code,
        statut: session.statut,
        expires_at: session.expires_at,
        nb_attendus: parseInt(totalResult.rows[0].total),
        presences: presencesResult.rows,
      },
    });
  } catch (error) {
    console.error('[getSessionQr]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement de la session.' });
  }
};

// POST /api/appels/qr/checkin - L'étudiant se pointe avec le code (scanné ou saisi)
const checkin = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !String(code).trim()) {
      return res.status(400).json({ success: false, message: 'Le code est requis.' });
    }

    // Le QR encode le token UUID ; la saisie manuelle utilise le code à 6 chiffres.
    const sessionResult = await pool.query(`
      SELECT s.*, a.filiere_id, a.filiere_nom, a.professeur_id, a.module_id
      FROM appel_qr_sessions s
      JOIN appels a ON a.id = s.appel_id
      WHERE (s.code = $1 OR s.token = $1)
        AND s.statut = 'ouverte' AND s.expires_at > NOW()
      ORDER BY s.created_at DESC LIMIT 1
    `, [String(code).trim()]);
    const session = sessionResult.rows[0];
    if (!session) {
      return res.status(404).json({ success: false, message: 'Code invalide ou session expirée.' });
    }

    const etudiantResult = await pool.query(
      `SELECT id, matricule, nom, prenoms, filiere_id FROM etudiants WHERE user_id = $1`,
      [req.user.id],
    );
    const etudiant = etudiantResult.rows[0];
    if (!etudiant) {
      return res.status(404).json({ success: false, message: 'Profil étudiant non trouvé.' });
    }
    if (etudiant.filiere_id !== session.filiere_id) {
      return res.status(403).json({ success: false, message: 'Cette session ne concerne pas votre classe.' });
    }

    const dejaPresent = await pool.query(
      `SELECT id FROM appel_presences WHERE appel_id = $1 AND etudiant_id = $2`,
      [session.appel_id, etudiant.id],
    );
    if (dejaPresent.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Présence déjà enregistrée.' });
    }

    await pool.query(`
      INSERT INTO appel_presences (appel_id, etudiant_id, matricule, nom, prenoms, statut)
      VALUES ($1, $2, $3, $4, $5, 'present')
    `, [session.appel_id, etudiant.id, etudiant.matricule, etudiant.nom, etudiant.prenoms]);

    // Suivi en direct côté prof
    const io = req.app.get('io');
    if (io) {
      io.emit(`appel_qr:${session.id}`, {
        matricule: etudiant.matricule,
        nom: etudiant.nom,
        prenoms: etudiant.prenoms,
        statut: 'present',
      });
    }

    res.status(201).json({ success: true, message: 'Présence enregistrée. Bonne séance !' });
  } catch (error) {
    console.error('[checkin]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement de la présence.' });
  }
};

// POST /api/appels/qr/:sessionId/cloturer - Clôture : les non-pointés sont absents,
// notification à l'étudiant et SMS au parent (prof)
const cloturerSessionQr = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionResult = await pool.query(`
      SELECT s.*, a.filiere_id, a.filiere_nom, a.professeur_id, m.nom AS module_nom
      FROM appel_qr_sessions s
      JOIN appels a ON a.id = s.appel_id
      JOIN modules m ON m.id = a.module_id
      WHERE s.id = $1
    `, [sessionId]);
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ success: false, message: 'Session non trouvée.' });
    if (session.professeur_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
    if (session.statut !== 'ouverte') {
      return res.status(400).json({ success: false, message: 'Session déjà clôturée.' });
    }

    // Étudiants de la classe qui n'ont pas pointé → absents
    const absentsResult = await pool.query(`
      SELECT e.id, e.user_id, e.matricule, e.nom, e.prenoms, e.tel_parent
      FROM etudiants e
      WHERE e.filiere_id = $1 AND (e.statut = 'actif' OR e.statut IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM appel_presences ap WHERE ap.appel_id = $2 AND ap.etudiant_id = e.id
        )
    `, [session.filiere_id, session.appel_id]);

    for (const e of absentsResult.rows) {
      await pool.query(`
        INSERT INTO appel_presences (appel_id, etudiant_id, matricule, nom, prenoms, statut)
        VALUES ($1, $2, $3, $4, $5, 'absent')
      `, [session.appel_id, e.id, e.matricule, e.nom, e.prenoms]);

      if (e.user_id) {
        await envoyerNotificationAuto(
          e.user_id,
          'Absence enregistrée',
          `Vous avez été marqué(e) absent(e) au cours de ${session.module_nom} (${session.filiere_nom}).`,
        );
      }
      if (e.tel_parent) {
        await envoyerSMS(
          e.tel_parent,
          `ScolarHub : ${e.prenoms} ${e.nom} a ete marque(e) absent(e) au cours de ${session.module_nom} aujourd'hui.`,
        );
      }
    }

    await pool.query(`UPDATE appel_qr_sessions SET statut = 'cloturee' WHERE id = $1`, [sessionId]);

    res.json({
      success: true,
      message: 'Appel clôturé.',
      nb_absents: absentsResult.rows.length,
    });
  } catch (error) {
    console.error('[cloturerSessionQr]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la clôture de la session.' });
  }
};

module.exports = { ouvrirSessionQr, getSessionQr, checkin, cloturerSessionQr };
