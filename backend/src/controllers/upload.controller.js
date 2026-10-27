/**
 * Contrôleur pour les uploads de fichiers (copies d'examen, photos de
 * profil/couverture, etc.)
 */

const pool = require('../config/db');

// POST /api/upload/copie - Upload une copie d'examen
exports.uploadExamCopy = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier uploadé.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Fichier uploadé avec succès.',
      url: req.uploadedFileUrl,
    });
  } catch (error) {
    console.error('[uploadExamCopy] Erreur :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'upload du fichier.',
      error: error.message,
    });
  }
};

// POST /api/upload/message — pièce jointe de message (document, photo,
// vidéo ou audio) dans une conversation (canal, groupe filière, privé).
exports.uploadMessageFile = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    }
    res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (error) {
    console.error('[uploadMessageFile] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'upload du fichier.' });
  }
};

// ── Photo de profil / couverture ──────────────────────────────────────────
// ✅ NOUVEAU — remplace l'ancien système (ProfileMediaService côté Flutter)
// qui passait directement par le client Supabase, avec RLS bloquant
// silencieusement les écritures, un nom de table erroné ('profs' au lieu de
// 'professeurs'), et une clé de cache basée sur le matricule — vide pour les
// professeurs (plus de matricule généré depuis la refonte du login), ce qui
// faisait partager LA MÊME photo à tous les professeurs sans matricule.
// Ici : authentification JWT classique (req.user.id, toujours présent et
// stable, quel que soit le rôle), persistance directe dans users.photo_url /
// users.cover_url — la même table utilisée partout ailleurs dans l'app.

// POST /api/upload/photo-profil
exports.uploadPhotoProfil = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    }
    await pool.query('UPDATE users SET photo_url = $1 WHERE id = $2', [req.uploadedFileUrl, req.user.id]);
    res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (error) {
    console.error('[uploadPhotoProfil] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de la photo de profil.' });
  }
};

// POST /api/upload/photo-couverture
exports.uploadPhotoCouverture = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    }
    await pool.query('UPDATE users SET cover_url = $1 WHERE id = $2', [req.uploadedFileUrl, req.user.id]);
    res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (error) {
    console.error('[uploadPhotoCouverture] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de la photo de couverture.' });
  }
};

// DELETE /api/upload/photo-profil
exports.deletePhotoProfil = async (req, res) => {
  try {
    await pool.query('UPDATE users SET photo_url = NULL WHERE id = $1', [req.user.id]);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[deletePhotoProfil] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression de la photo de profil.' });
  }
};

// DELETE /api/upload/photo-couverture
exports.deletePhotoCouverture = async (req, res) => {
  try {
    await pool.query('UPDATE users SET cover_url = NULL WHERE id = $1', [req.user.id]);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[deletePhotoCouverture] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression de la photo de couverture.' });
  }
};

// ── Attestation de service ────────────────────────────────────────────────
// Même schéma que photo-profil/photo-couverture ci-dessus : authentification
// JWT (req.user.id), persistance directe dans users.attestation_url.

// POST /api/upload/attestation-service
exports.uploaderAttestationService = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    }
    await pool.query('UPDATE users SET attestation_url = $1 WHERE id = $2', [req.uploadedFileUrl, req.user.id]);
    res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (error) {
    console.error('[uploaderAttestationService] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de l\'attestation de service.' });
  }
};

// DELETE /api/upload/attestation-service
exports.supprimerAttestationService = async (req, res) => {
  try {
    await pool.query('UPDATE users SET attestation_url = NULL WHERE id = $1', [req.user.id]);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[supprimerAttestationService] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression de l\'attestation de service.' });
  }
};


// ── Logo de l'établissement ───────────────────────────────────────────────
// Stocké dans une petite table clé/valeur (créée à la volée si besoin, voir
// aussi migration_logo_etablissement.sql). Lecture : tout utilisateur connecté.
// Écriture : Super Admin, ou membre autorisé (permission « logo »).
async function assurerTableIdentite() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS etablissement_identite (
       cle TEXT PRIMARY KEY,
       valeur TEXT,
       updated_at TIMESTAMPTZ DEFAULT NOW()
     )`
  );
}

async function estSuperAdmin(userId) {
  const r = await pool.query('SELECT role, admin_sub_role FROM users WHERE id = $1', [userId]);
  if (!r.rows.length) return false;
  const role = String(r.rows[0].role || '').toLowerCase();
  const sub = String(r.rows[0].admin_sub_role || '').toLowerCase().replace(/[\s-]/g, '_');
  return role === 'super_admin' || (role === 'admin' && sub.includes('super'));
}

// Multi-établissement : avec un jeton portant etablissement_id, le logo est celui de
// l'établissement (etablissements.logo_url) ; sans (anciens jetons), l'ancienne
// table globale etablissement_identite est utilisée comme avant.

// GET /api/upload/logo-etablissement
exports.getLogoEtablissement = async (req, res) => {
  try {
    if (req.etablissementId) {
      const r = await pool.query('SELECT logo_url FROM etablissements WHERE id = $1', [req.etablissementId]);
      return res.status(200).json({ success: true, url: r.rows[0]?.logo_url || '' });
    }
    await assurerTableIdentite();
    const r = await pool.query("SELECT valeur FROM etablissement_identite WHERE cle = 'logo_url'");
    res.status(200).json({ success: true, url: r.rows[0]?.valeur || '' });
  } catch (error) {
    console.error('[getLogoEtablissement] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la lecture du logo.' });
  }
};

// Droit de gérer le logo : le Super Admin, ou un membre de l'administration à qui le
// Super Admin a activé l'autorisation « logo » (Membres & Rôles).
async function peutGerer(userId, cle) {
  if (await estSuperAdmin(userId)) return true;
  try {
    const r = await pool.query(
      `SELECT u.role, COALESCE(m.permissions, '{}'::jsonb) AS permissions
       FROM users u LEFT JOIN membres m ON m.user_id = u.id WHERE u.id = $1`, [userId]
    );
    const row = r.rows[0];
    if (!row || String(row.role).toLowerCase() !== 'admin') return false;
    let perms = row.permissions || {};
    if (typeof perms === 'string') { try { perms = JSON.parse(perms); } catch (_) { perms = {}; } }
    return perms[cle] === true;
  } catch (_) {
    return false;
  }
}

// Middleware placé AVANT l'envoi du fichier : on refuse sans rien téléverser.
// Deux autorisations distinctes dans Membres & Rôles : « logo » (logo officiel, documents)
// et « photo_accueil » (image de bienvenue après le code).
const exiger = (cle, libelle) => async (req, res, next) => {
  try {
    if (await peutGerer(req.user.id, cle)) return next();
    return res.status(403).json({ success: false, message: `Vous n'avez pas l'autorisation de gérer ${libelle}.` });
  } catch (error) {
    console.error('[exiger ' + cle + '] Erreur :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};
exports.exigerGestionLogo = exiger('logo', "le logo de l'établissement");
exports.exigerGestionPhotoAccueil = exiger('photo_accueil', "la photo d'accueil");

// POST /api/upload/logo-etablissement (Super Admin ou membre autorisé)
exports.uploadLogoEtablissement = async (req, res) => {
  try {
    if (!(await peutGerer(req.user.id, 'logo'))) {
      return res.status(403).json({ success: false, message: "Vous n'avez pas l'autorisation de gérer le logo de l'établissement." });
    }
    if (!/\.(png|jpe?g)$/i.test(String(req.uploadedFileName || ''))) {
      return res.status(400).json({ success: false, message: 'Le logo doit être une image PNG ou JPG.' });
    }
    if (!req.uploadedFileUrl) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    }
    if (req.etablissementId) {
      await pool.query('UPDATE etablissements SET logo_url = $1 WHERE id = $2', [req.uploadedFileUrl, req.etablissementId]);
      return res.status(200).json({ success: true, url: req.uploadedFileUrl });
    }
    await assurerTableIdentite();
    await pool.query(
      `INSERT INTO etablissement_identite (cle, valeur) VALUES ('logo_url', $1)
       ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, updated_at = NOW()`,
      [req.uploadedFileUrl]
    );
    res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (error) {
    console.error('[uploadLogoEtablissement] Erreur :', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'enregistrement du logo." });
  }
};

// ── Photo d'accueil ─────────────────────────────────────────────────────────
// Image de bienvenue (photo d'étudiants, affiche...) montrée après la saisie du code
// de l'établissement. Distincte du logo officiel (documents). Même droit que le logo.
// GET /api/upload/photo-accueil
exports.getPhotoAccueil = async (req, res) => {
  try {
    if (!req.etablissementId) return res.status(200).json({ success: true, url: '' });
    const r = await pool.query('SELECT photo_accueil_url FROM etablissements WHERE id = $1', [req.etablissementId]);
    res.status(200).json({ success: true, url: r.rows[0]?.photo_accueil_url || '' });
  } catch (error) {
    console.error('[getPhotoAccueil] Erreur :', error);
    res.status(500).json({ success: false, message: "Erreur lors de la lecture de la photo d'accueil." });
  }
};

// POST /api/upload/photo-accueil
exports.uploadPhotoAccueil = async (req, res) => {
  try {
    if (!(await peutGerer(req.user.id, 'photo_accueil'))) {
      return res.status(403).json({ success: false, message: "Vous n'avez pas l'autorisation de gérer la photo d'accueil." });
    }
    if (!req.etablissementId) return res.status(400).json({ success: false, message: 'Établissement inconnu.' });
    if (!/\.(png|jpe?g)$/i.test(String(req.uploadedFileName || ''))) {
      return res.status(400).json({ success: false, message: 'La photo doit être une image PNG ou JPG.' });
    }
    if (!req.uploadedFileUrl) return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    await pool.query('UPDATE etablissements SET photo_accueil_url = $1 WHERE id = $2', [req.uploadedFileUrl, req.etablissementId]);
    res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (error) {
    console.error('[uploadPhotoAccueil] Erreur :', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'enregistrement de la photo d'accueil." });
  }
};

// DELETE /api/upload/photo-accueil
exports.deletePhotoAccueil = async (req, res) => {
  try {
    if (!(await peutGerer(req.user.id, 'photo_accueil'))) {
      return res.status(403).json({ success: false, message: "Vous n'avez pas l'autorisation de gérer la photo d'accueil." });
    }
    if (!req.etablissementId) return res.status(400).json({ success: false, message: 'Établissement inconnu.' });
    await pool.query('UPDATE etablissements SET photo_accueil_url = NULL WHERE id = $1', [req.etablissementId]);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[deletePhotoAccueil] Erreur :', error);
    res.status(500).json({ success: false, message: "Erreur lors de la suppression de la photo d'accueil." });
  }
};

// DELETE /api/upload/logo-etablissement (Super Admin ou membre autorisé)
exports.deleteLogoEtablissement = async (req, res) => {
  try {
    if (!(await peutGerer(req.user.id, 'logo'))) {
      return res.status(403).json({ success: false, message: "Vous n'avez pas l'autorisation de gérer le logo de l'établissement." });
    }
    if (req.etablissementId) {
      await pool.query('UPDATE etablissements SET logo_url = NULL WHERE id = $1', [req.etablissementId]);
      return res.status(200).json({ success: true });
    }
    await assurerTableIdentite();
    await pool.query("DELETE FROM etablissement_identite WHERE cle = 'logo_url'");
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[deleteLogoEtablissement] Erreur :', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression du logo.' });
  }
};