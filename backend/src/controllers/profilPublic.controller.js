const pool = require('../config/db');

// ── GET /api/profil-public/:id ──────────────────────────────────────────────
// Fiche « Infos du contact » visible par les autres membres de l'établissement.
// Ne renvoie VOLONTAIREMENT ni email, ni téléphone, ni matricule, ni date de
// naissance : uniquement ce que la personne accepte de montrer.
exports.voir = async (req, res) => {
  try {
    // Les identifiants utilisateurs sont des UUID.
    const id = String(req.params.id || '').trim();
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
      return res.status(400).json({ success: false, message: 'Identifiant invalide.' });
    }
    const params = [id];
    let filtreEtab = '';
    if (req.etablissementId) {
      params.push(req.etablissementId);
      filtreEtab = ` AND u.etablissement_id = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT u.id, u.nom, u.prenoms, u.role, u.etudiant_role,
              u.photo_url, u.cover_url, u.biographie, u.centres_interet,
              u.facebook, u.whatsapp, u.linkedin,
              COALESCE(e.adresse, u.adresse) AS adresse,
              e.filiere_nom, e.niveau
       FROM users u LEFT JOIN etudiants e ON e.user_id = u.id
       WHERE u.id = $1${filtreEtab}`,
      params
    );
    const u = r.rows[0];
    if (!u) return res.status(404).json({ success: false, message: 'Profil introuvable.' });
    return res.status(200).json({
      success: true,
      data: {
        id: u.id,
        nom: u.nom || '',
        prenoms: u.prenoms || '',
        role: (u.role === 'etudiant' && u.etudiant_role) ? u.etudiant_role : (u.role || 'etudiant'),
        photo_url: u.photo_url || null,
        cover_url: u.cover_url || null,
        biographie: u.biographie || '',
        centres_interet: u.centres_interet || '',
        facebook: u.facebook || '',
        whatsapp: u.whatsapp || '',
        linkedin: u.linkedin || '',
        adresse: u.adresse || '',
        filiere: u.filiere_nom || '',
        niveau: u.niveau || '',
      },
    });
  } catch (err) {
    console.error('[profilPublic]', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};