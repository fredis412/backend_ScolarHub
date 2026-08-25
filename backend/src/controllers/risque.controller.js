const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');
const { envoyerSMS } = require('../services/sms.service');

// Pondération du score de risque (0-100, plus haut = plus à risque)
const POIDS_MOYENNE = 50;   // moyenne générale faible
const POIDS_ABSENCES = 40;  // taux d'absence sur la période
const POIDS_RETARDS = 10;   // taux de retard sur la période
const PERIODE_JOURS = 60;   // fenêtre d'analyse des présences

const niveauRisque = (score) => {
  if (score >= 70) return 'critique';
  if (score >= 50) return 'eleve';
  if (score >= 30) return 'modere';
  return 'faible';
};

// GET /api/risque - Score de risque de décrochage par étudiant (admin)
// Croise moyenne générale (notes validées) et assiduité (appels) sur 60 jours.
const getEtudiantsARisque = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id, e.user_id, e.matricule, e.nom, e.prenoms,
        e.filiere_nom, e.niveau, e.tel_parent, e.nom_parent,
        moy.moyenne,
        COALESCE(pres.nb_total, 0)   AS nb_seances,
        COALESCE(pres.nb_absents, 0) AS nb_absences,
        COALESCE(pres.nb_retards, 0) AS nb_retards
      FROM etudiants e
      LEFT JOIN (
        SELECT n.etudiant_id, ROUND(AVG(n.valeur)::numeric, 2) AS moyenne
        FROM notes n
        JOIN sessions_notes s ON n.session_id = s.id
        WHERE s.statut = 'validee'
        GROUP BY n.etudiant_id
      ) moy ON moy.etudiant_id = e.id
      LEFT JOIN (
        SELECT ap.etudiant_id,
          COUNT(*) AS nb_total,
          COUNT(*) FILTER (WHERE ap.statut = 'absent') AS nb_absents,
          COUNT(*) FILTER (WHERE ap.statut = 'retard') AS nb_retards
        FROM appel_presences ap
        JOIN appels a ON a.id = ap.appel_id
        WHERE a.date_appel >= CURRENT_DATE - INTERVAL '${PERIODE_JOURS} days'
        GROUP BY ap.etudiant_id
      ) pres ON pres.etudiant_id = e.id
      WHERE e.statut = 'actif' OR e.statut IS NULL
      ORDER BY e.nom
    `);

    const etudiants = result.rows.map((e) => {
      const moyenne = e.moyenne !== null ? parseFloat(e.moyenne) : null;
      const nbSeances = parseInt(e.nb_seances) || 0;
      const nbAbsences = parseInt(e.nb_absences) || 0;
      const nbRetards = parseInt(e.nb_retards) || 0;

      const tauxAbsence = nbSeances > 0 ? nbAbsences / nbSeances : 0;
      const tauxRetard = nbSeances > 0 ? nbRetards / nbSeances : 0;
      // Sans note connue, on ne pénalise que sur l'assiduité.
      const composanteMoyenne = moyenne !== null ? ((20 - moyenne) / 20) * POIDS_MOYENNE : 0;
      const score = Math.round(
        composanteMoyenne + tauxAbsence * POIDS_ABSENCES + tauxRetard * POIDS_RETARDS,
      );

      return {
        etudiant_id: e.id,
        user_id: e.user_id,
        matricule: e.matricule,
        nom: e.nom,
        prenoms: e.prenoms,
        filiere_nom: e.filiere_nom,
        niveau: e.niveau,
        nom_parent: e.nom_parent,
        tel_parent: e.tel_parent,
        moyenne,
        nb_seances: nbSeances,
        nb_absences: nbAbsences,
        nb_retards: nbRetards,
        taux_absence: Math.round(tauxAbsence * 100),
        score,
        niveau_risque: niveauRisque(score),
      };
    });

    // Les plus à risque en premier
    etudiants.sort((a, b) => b.score - a.score);

    res.json({ success: true, periode_jours: PERIODE_JOURS, data: etudiants });
  } catch (error) {
    console.error('[getEtudiantsARisque]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du calcul des risques.' });
  }
};

// POST /api/risque/:etudiantId/alerter - Alerte l'étudiant (notification) et le parent (SMS)
const alerterEtudiant = async (req, res) => {
  try {
    const { etudiantId } = req.params;
    const { message } = req.body;

    const result = await pool.query(
      `SELECT id, user_id, nom, prenoms, tel_parent, nom_parent FROM etudiants WHERE id = $1`,
      [etudiantId],
    );
    const etudiant = result.rows[0];
    if (!etudiant) {
      return res.status(404).json({ success: false, message: 'Étudiant non trouvé.' });
    }

    const corps = message ||
      'Votre situation académique nécessite votre attention (résultats et/ou assiduité). ' +
      'Rapprochez-vous de la scolarité pour un accompagnement.';

    let notifEnvoyee = false;
    if (etudiant.user_id) {
      const notif = await envoyerNotificationAuto(etudiant.user_id, 'Suivi académique — alerte', corps);
      notifEnvoyee = notif.success;
    }

    let smsEnvoye = false;
    if (etudiant.tel_parent) {
      const sms = await envoyerSMS(
        etudiant.tel_parent,
        `ScolarHub : la situation academique de ${etudiant.prenoms} ${etudiant.nom} necessite votre attention. Merci de contacter l'etablissement.`,
      );
      smsEnvoye = sms.success;
    }

    res.json({
      success: true,
      message: 'Alerte envoyée.',
      notification_etudiant: notifEnvoyee,
      sms_parent: smsEnvoye,
    });
  } catch (error) {
    console.error('[alerterEtudiant]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi de l\'alerte.' });
  }
};

module.exports = { getEtudiantsARisque, alerterEtudiant };
