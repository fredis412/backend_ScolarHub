const pool = require('../config/db');
const { getProvider, OPERATEURS } = require('../services/paiement.service');
const { envoyerNotificationAuto } = require('./notifications.controller');
const { envoyerSMS } = require('../services/sms.service');

const LABELS_OPERATEURS = {
  orange_money: 'Orange Money',
  wave: 'Wave',
  moov_money: 'Moov Money',
  mtn_momo: 'MTN MoMo',
};

// Retourne la ligne etudiants correspondant à l'utilisateur connecté.
const getEtudiantByUser = async (userId) => {
  const result = await pool.query(
    `SELECT id, user_id, matricule, nom, prenoms, filiere_nom, niveau, tel_parent
     FROM etudiants WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
};

// GET /api/paiements - Frais à payer + historique de l'étudiant connecté
const getMesPaiements = async (req, res) => {
  try {
    const etudiant = await getEtudiantByUser(req.user.id);
    if (!etudiant) {
      return res.status(404).json({ success: false, message: 'Profil étudiant non trouvé.' });
    }

    const fraisResult = await pool.query(`
      SELECT f.* FROM frais_scolarite f
      WHERE (f.niveau IS NULL OR f.niveau = $1)
        AND f.actif = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM paiements p
          WHERE p.frais_id = f.id AND p.etudiant_id = $2 AND p.statut = 'reussi'
        )
      ORDER BY f.echeance NULLS LAST, f.libelle
    `, [etudiant.niveau, etudiant.id]);

    const historiqueResult = await pool.query(`
      SELECT p.*, f.libelle AS frais_libelle
      FROM paiements p
      LEFT JOIN frais_scolarite f ON f.id = p.frais_id
      WHERE p.etudiant_id = $1 AND p.statut = 'reussi'
      ORDER BY p.created_at DESC
    `, [etudiant.id]);

    res.json({
      success: true,
      etudiant: {
        nom: etudiant.nom,
        prenoms: etudiant.prenoms,
        matricule: etudiant.matricule,
        filiere_nom: etudiant.filiere_nom,
      },
      frais: fraisResult.rows,
      historique: historiqueResult.rows,
    });
  } catch (error) {
    console.error('[getMesPaiements]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des paiements.' });
  }
};

// POST /api/paiements/initier - Lance un paiement mobile money
const initierPaiement = async (req, res) => {
  try {
    const { frais_id, montant, telephone, operateur } = req.body;
    if (!frais_id || !montant || !telephone || !operateur) {
      return res.status(400).json({ success: false, message: 'frais_id, montant, telephone et operateur sont requis.' });
    }
    if (!OPERATEURS.includes(operateur)) {
      return res.status(400).json({ success: false, message: `Opérateur invalide. Choix : ${OPERATEURS.join(', ')}` });
    }
    const montantNum = Number(montant);
    if (!Number.isFinite(montantNum) || montantNum <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide.' });
    }

    const etudiant = await getEtudiantByUser(req.user.id);
    if (!etudiant) {
      return res.status(404).json({ success: false, message: 'Profil étudiant non trouvé.' });
    }

    const fraisResult = await pool.query(`SELECT * FROM frais_scolarite WHERE id = $1`, [frais_id]);
    const frais = fraisResult.rows[0];
    if (!frais) {
      return res.status(404).json({ success: false, message: 'Frais non trouvé.' });
    }

    const provider = getProvider();
    const init = await provider.initier({
      montant: montantNum,
      telephone,
      operateur,
      description: `${frais.libelle} — ${etudiant.prenoms} ${etudiant.nom}`,
    });
    if (!init.success) {
      return res.status(502).json({ success: false, message: init.error || 'Échec de l\'initialisation du paiement.' });
    }

    const insert = await pool.query(`
      INSERT INTO paiements (etudiant_id, frais_id, montant, operateur, telephone, reference, statut)
      VALUES ($1, $2, $3, $4, $5, $6, 'en_attente')
      RETURNING id, reference
    `, [etudiant.id, frais_id, montantNum, operateur, telephone, init.reference]);

    res.status(201).json({
      success: true,
      paiement_id: insert.rows[0].id,
      reference: init.reference,
      otp_requis: init.otp_requis !== false,
      payment_url: init.payment_url || null,
    });
  } catch (error) {
    console.error('[initierPaiement]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'initialisation du paiement.' });
  }
};

// POST /api/paiements/:id/confirmer - Confirme le paiement (code OTP)
const confirmerPaiement = async (req, res) => {
  try {
    const { id } = req.params;
    const { code } = req.body;

    const etudiant = await getEtudiantByUser(req.user.id);
    if (!etudiant) {
      return res.status(404).json({ success: false, message: 'Profil étudiant non trouvé.' });
    }

    const paiementResult = await pool.query(
      `SELECT p.*, f.libelle AS frais_libelle FROM paiements p
       LEFT JOIN frais_scolarite f ON f.id = p.frais_id
       WHERE p.id = $1 AND p.etudiant_id = $2`,
      [id, etudiant.id],
    );
    const paiement = paiementResult.rows[0];
    if (!paiement) {
      return res.status(404).json({ success: false, message: 'Paiement non trouvé.' });
    }
    if (paiement.statut === 'reussi') {
      return res.status(400).json({ success: false, message: 'Ce paiement est déjà confirmé.' });
    }

    const provider = getProvider();
    const conf = await provider.confirmer({ reference: paiement.reference, code });
    if (!conf.success) {
      return res.status(402).json({ success: false, message: conf.error || 'Paiement refusé.' });
    }

    await pool.query(
      `UPDATE paiements SET statut = 'reussi', transaction_id = $2, confirmed_at = NOW() WHERE id = $1`,
      [id, conf.transaction_id || null],
    );

    const modeLabel = LABELS_OPERATEURS[paiement.operateur] || paiement.operateur;
    await envoyerNotificationAuto(
      req.user.id,
      'Paiement confirmé',
      `Votre paiement "${paiement.frais_libelle || 'Frais de scolarité'}" de ${paiement.montant} FCFA via ${modeLabel} a été confirmé. Réf : ${paiement.reference}`,
    );
    if (etudiant.tel_parent) {
      await envoyerSMS(
        etudiant.tel_parent,
        `ScolarHub : paiement de ${paiement.montant} FCFA (${paiement.frais_libelle || 'scolarite'}) recu pour ${etudiant.prenoms} ${etudiant.nom}. Ref ${paiement.reference}.`,
      );
    }

    res.json({
      success: true,
      message: 'Paiement confirmé.',
      recu: {
        reference: paiement.reference,
        transaction_id: conf.transaction_id,
        libelle: paiement.frais_libelle,
        montant: paiement.montant,
        mode: modeLabel,
        etudiant: `${etudiant.prenoms} ${etudiant.nom}`,
        matricule: etudiant.matricule,
        filiere: etudiant.filiere_nom,
        date: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[confirmerPaiement]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la confirmation du paiement.' });
  }
};

// GET /api/paiements/admin/all - Tous les paiements (admin)
const getPaiementsAdmin = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, f.libelle AS frais_libelle, e.nom, e.prenoms, e.matricule, e.filiere_nom
      FROM paiements p
      LEFT JOIN frais_scolarite f ON f.id = p.frais_id
      LEFT JOIN etudiants e ON e.id = p.etudiant_id
      ORDER BY p.created_at DESC
      LIMIT 500
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[getPaiementsAdmin]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des paiements.' });
  }
};

module.exports = { getMesPaiements, initierPaiement, confirmerPaiement, getPaiementsAdmin };
