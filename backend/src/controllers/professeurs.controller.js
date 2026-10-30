const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { getOrCreateCanalProfDelegue } = require('../utils/canauxProfDelegue');
const { messageConflitUnique } = require('../utils/erreursSql');

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
const etabCol = (params, etabId, col) => {
  if (!etabId) return '';
  params.push(etabId);
  return ` AND ${col} = $${params.length}`;
};
const profDeMonEtab = async (profId, etabId) => {
  if (!etabId) return true;
  const r = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND role = 'professeur' AND etablissement_id = $2`, [profId, etabId]
  );
  return r.rows.length > 0;
};
const filiereDeMonEtab = async (filiereId, etabId) => {
  if (!etabId) return true;
  if (filiereId === undefined || filiereId === null || filiereId === '') return false;
  const r = await db.query('SELECT 1 FROM filieres WHERE id = $1 AND etablissement_id = $2', [filiereId, etabId]);
  return r.rows.length > 0;
};

// ── GET /api/professeurs ──────────────────────────────────────────────────────
// Renvoie chaque professeur avec ses affectations (filière + niveau), agrégées.
exports.getAllProfesseurs = async (req, res) => {
  try {
    const pa = [];
    const fa = etabCol(pa, req.etablissementId, 'u.etablissement_id');
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenoms, u.email, u.tel, u.statut, u.domaine, u.photo_url,
              u.date_naissance, u.nationalite,
              p.sexe, p.lieu_naissance, p.grade, p.matricule, p.expertise, p.diplome, p.note,
              (SELECT COALESCE(json_agg(
                        json_build_object('filiere_id', f.id, 'filiere_nom', f.nom,
                                          'abreviation', f.abreviation, 'niveau', pf.niveau)
                        ORDER BY f.nom, pf.niveau), '[]')
                 FROM professeur_filieres pf
                 JOIN filieres f ON f.id = pf.filiere_id
                WHERE pf.professeur_id = u.id) AS affectations,
              (SELECT COALESCE(json_agg(
                        json_build_object('affectation_id', pm.id, 'module_id', m.id, 'module_nom', m.nom,
                                          'filiere_id', pm.filiere_id, 'filiere_nom', f2.nom,
                                          'abreviation', f2.abreviation, 'niveau', pm.niveau,
                                          'semestre', pm.semestre)
                        ORDER BY f2.nom, pm.niveau, pm.semestre, m.nom), '[]')
                 FROM professeur_modules pm
                 JOIN modules m ON m.id = pm.module_id
                 LEFT JOIN filieres f2 ON f2.id = pm.filiere_id
                WHERE pm.professeur_id = u.id) AS modules
       FROM users u
       LEFT JOIN LATERAL (SELECT * FROM professeurs WHERE user_id = u.id ORDER BY id DESC LIMIT 1) p ON true
       WHERE u.role = 'professeur'${fa}
       ORDER BY u.nom ASC`,
      pa
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getAllProfesseurs:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/professeurs/lookup?nom=X&tel=Y ───────────────────────────────────
// Conservé pour compatibilité mais la connexion prof passe désormais par
// /api/auth/lookup (générique, gère nom+prénom+tel pour tous les rôles).
exports.lookupProfesseur = async (req, res) => {
  try {
    const { nom, tel, matricule } = req.query;
    let user = null;

    if (matricule) {
      const pl = [matricule.trim().toUpperCase()];
      const r = await db.query(
        `SELECT id, nom, prenoms, matricule, role, statut, domaine,
                mot_de_passe IS NOT NULL AS a_mot_de_passe
         FROM users WHERE matricule = $1 AND role = 'professeur'${etabCol(pl, req.etablissementId, 'etablissement_id')}`,
        pl
      );
      user = r.rows[0];
    } else if (nom && tel) {
      const pl = [nom.trim(), tel.trim()];
      const r = await db.query(
        `SELECT id, nom, prenoms, matricule, role, statut, domaine,
                mot_de_passe IS NOT NULL AS a_mot_de_passe
         FROM users WHERE LOWER(nom) = LOWER($1) AND tel = $2 AND role = 'professeur'${etabCol(pl, req.etablissementId, 'etablissement_id')}`,
        pl
      );
      user = r.rows[0];
    } else {
      return res.status(400).json({ found: false, message: 'Matricule ou nom+tel requis.' });
    }

    if (!user) return res.status(404).json({ found: false, message: 'Professeur introuvable.' });
    if (user.statut === 'suspendu') return res.status(403).json({ found: false, message: 'Compte suspendu.' });

    return res.status(200).json({
      found: true,
      premierLogin: !user.a_mot_de_passe,
      userId: user.id,
      user: {
        id: user.id, nom: user.nom, prenoms: user.prenoms,
        matricule: user.matricule, role: user.role,
        domaine: user.domaine || '',
      },
    });
  } catch (err) {
    console.error('lookupProfesseur:', err.message);
    res.status(500).json({ found: false, message: 'Erreur serveur.' });
  }
};

// ── Utilitaire : remplace les affectations (filière + niveau) d'un prof ──────
const remplacerAffectations = async (client, professeurId, affectations, etabId) => {
  await client.query('DELETE FROM professeur_filieres WHERE professeur_id = $1', [professeurId]);
  if (!Array.isArray(affectations) || affectations.length === 0) return;
  for (const a of affectations) {
    const filiereId = a.filiere_id ?? a.filiereId;
    const niveau = a.niveau;
    if (!filiereId || !niveau) continue;
    if (!(await filiereDeMonEtab(filiereId, etabId))) continue; // filière d'un autre établissement
    await client.query(
      `INSERT INTO professeur_filieres (professeur_id, filiere_id, niveau)
       VALUES ($1, $2, $3) ON CONFLICT (professeur_id, filiere_id, niveau) DO NOTHING`,
      [professeurId, filiereId, niveau]
    );
    // Groupe « Professeur ↔ délégués » créé automatiquement pour cette classe
    // (ne bloque jamais l'enregistrement si la création échoue).
    try {
      await getOrCreateCanalProfDelegue(professeurId, filiereId, niveau);
    } catch (e) {
      console.error('[remplacerAffectations] sous-fil prof-délégué:', e.message);
    }
  }
};

// ── Utilitaire : enregistre les champs d'identité / complémentaires ───────────
// (sexe, lieu de naissance, grade, matricule, spécialité, diplôme, note → professeurs ;
//  date de naissance, nationalité → users). Ne touche que les champs envoyés.
const enregistrerChampsProf = async (client, userId, b) => {
  const v = (x) => (x === undefined ? undefined : (x === null || String(x).trim() === '' ? null : String(x).trim()));
  const dn = v(b.date_naissance ?? b.dateNaissance);
  const nat = v(b.nationalite);
  const setsU = []; const pu = [];
  if (dn !== undefined)  { pu.push(dn);  setsU.push(`date_naissance = $${pu.length}`); }
  if (nat !== undefined) { pu.push(nat); setsU.push(`nationalite = $${pu.length}`); }
  if (setsU.length) {
    pu.push(userId);
    await client.query(`UPDATE users SET ${setsU.join(', ')} WHERE id = $${pu.length}`, pu);
  }
  const map = {
    sexe: v(b.sexe) ? String(v(b.sexe)).toUpperCase().slice(0, 1) : v(b.sexe),
    lieu_naissance: v(b.lieu_naissance ?? b.lieuNaissance),
    grade: v(b.grade), matricule: v(b.matricule), expertise: v(b.expertise),
    diplome: v(b.diplome), note: v(b.note),
  };
  const setsP = []; const pp = [];
  for (const [col, val] of Object.entries(map)) {
    if (val === undefined) continue;
    pp.push(val); setsP.push(`${col} = $${pp.length}`);
  }
  if (setsP.length) {
    pp.push(userId);
    await client.query(`UPDATE professeurs SET ${setsP.join(', ')} WHERE user_id = $${pp.length}`, pp);
  }
};

// ── POST /api/professeurs ─────────────────────────────────────────────────────
// Plus de matricule ni de mot de passe générés : le prof se connecte par
// nom+prénom+téléphone et définit son mot de passe à sa première connexion
// (comme les admins et les parents), via /api/auth/lookup puis /api/auth/login.
exports.createProfesseur = async (req, res) => {
  const { nom, prenoms, tel, email, domaines, affectations } = req.body;
  if (!nom || !prenoms || !tel) {
    return res.status(400).json({ error: 'nom, prenoms et tel sont obligatoires.' });
  }
  const client = await db.connect();
  try {
    const domaineStr = Array.isArray(domaines) ? domaines.join(',') : (domaines || null);

    // 1. Insérer dans users — sans matricule, sans mot de passe
    const etabId = req.etablissementId || null;
    if (etabId) {
      await client.query(
        `INSERT INTO users (nom, prenoms, email, tel, role, domaine, statut, etablissement_id)
         VALUES ($1, $2, $3, $4, 'professeur', $5, 'actif', $6)`,
        [nom.trim().toUpperCase(), prenoms.trim(), email?.trim() || null, tel.trim(), domaineStr, etabId]
      );
    } else {
      await client.query(
        `INSERT INTO users (nom, prenoms, email, tel, role, domaine, statut)
         VALUES ($1, $2, $3, $4, 'professeur', $5, 'actif')`,
        [nom.trim().toUpperCase(), prenoms.trim(), email?.trim() || null, tel.trim(), domaineStr]
      );
    }

    // Récupérer l'utilisateur inséré (par tel, unique parmi les profs fraîchement créés)
    const pr = [tel.trim()];
    const userRow = await client.query(
      `SELECT id, nom, prenoms, email, tel, role, domaine, statut FROM users
       WHERE role = 'professeur' AND tel = $1${etabCol(pr, etabId, 'etablissement_id')} ORDER BY id DESC LIMIT 1`,
      pr
    );
    const user = userRow.rows[0];
    if (!user) throw new Error('Impossible de récupérer le professeur après insertion.');

    // 2. Table professeurs (fiche complémentaire)
    if (etabId) {
      await client.query(
        `INSERT INTO professeurs (user_id, specialite, etablissement_id) VALUES ($1, $2, $3)`,
        [user.id, domaineStr, etabId]
      );
    } else {
      await client.query(
        `INSERT INTO professeurs (user_id, specialite) VALUES ($1, $2)`,
        [user.id, domaineStr]
      );
    }

    // 3. Affectations filière + niveau (plusieurs possibles)
    await remplacerAffectations(client, user.id, affectations, etabId);

    // 4. Champs d'identité / complémentaires (p35)
    await enregistrerChampsProf(client, user.id, req.body);

    res.status(201).json({
      message: 'Professeur créé avec succès. Il pourra se connecter avec son nom, prénom et numéro de téléphone.',
      professeur: user,
    });
  } catch (err) {
    console.error('createProfesseur:', err.message);
    const doublon = messageConflitUnique(err);
    if (doublon) return res.status(409).json({ error: doublon, message: doublon });
    res.status(500).json({ error: 'Une erreur est survenue. Réessayez ou contactez le support.' });
  } finally {
    client.release();
  }
};

// ── PUT /api/professeurs/:id ──────────────────────────────────────────────────
exports.updateProfesseur = async (req, res) => {
  const { id } = req.params;
  const { nom, prenoms, email, tel, domaines, statut, affectations } = req.body;
  const client = await db.connect();
  try {
    const domaineStr = Array.isArray(domaines) ? domaines.join(',') : (domaines !== undefined ? domaines : null);

    if (!(await profDeMonEtab(id, req.etablissementId))) {
      return res.status(404).json({ error: 'Professeur non trouvé.' });
    }

    await client.query(
      `UPDATE users SET nom=COALESCE($1,nom), prenoms=COALESCE($2,prenoms),
       email=COALESCE($3,email), tel=COALESCE($4,tel),
       domaine=COALESCE($5,domaine), statut=COALESCE($6,statut)
       WHERE id=$7 AND role='professeur'`,
      [nom, prenoms, email, tel, domaineStr, statut, id]
    );

    if (affectations !== undefined) {
      await remplacerAffectations(client, id, affectations, req.etablissementId || null);
    }

    // Champs d'identité / complémentaires (p35)
    await enregistrerChampsProf(client, id, req.body);

    const result = await client.query(
      `SELECT id, nom, prenoms, email, tel, role, domaine, statut FROM users WHERE id=$1 AND role='professeur'`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Professeur non trouvé.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateProfesseur:', err.message);
    const doublon = messageConflitUnique(err);
    if (doublon) return res.status(409).json({ error: doublon, message: doublon });
    res.status(500).json({ error: 'Une erreur est survenue. Réessayez ou contactez le support.' });
  } finally {
    client.release();
  }
};

// ── POST /api/professeurs/:id/photo — photo d'identité (multipart `file`) ─────
exports.uploaderPhotoProfesseur = async (req, res) => {
  try {
    if (!req.uploadedFileUrl) return res.status(400).json({ success: false, message: 'Aucun fichier uploadé.' });
    if (!(await profDeMonEtab(req.params.id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Professeur introuvable.' });
    }
    await db.query('UPDATE users SET photo_url = $1 WHERE id = $2 AND role = \'professeur\'', [req.uploadedFileUrl, req.params.id]);
    res.status(200).json({ success: true, url: req.uploadedFileUrl });
  } catch (err) {
    console.error('[uploaderPhotoProfesseur]', err);
    res.status(500).json({ success: false, message: "Erreur lors de l'enregistrement de la photo." });
  }
};

// ── POST /api/professeurs/:id/reinitialiser-mdp — l'administration efface le mot de passe ──
// Le professeur reprend le parcours de première connexion (nom, prénom, téléphone) et
// choisit un nouveau mot de passe. Pour les comptes sans email.
exports.reinitialiserMotDePasse = async (req, res) => {
  try {
    const p = [req.params.id];
    const r = await db.query(
      `UPDATE users SET mot_de_passe = NULL, reset_code = NULL, reset_code_hash = NULL,
              reset_expires = NULL, reset_essais = 0
       WHERE id = $1 AND role = 'professeur'${etabCol(p, req.etablissementId, 'etablissement_id')} RETURNING id`,
      p
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Professeur introuvable.' });
    res.json({
      success: true,
      message: 'Mot de passe réinitialisé. Le professeur choisira un nouveau mot de passe à sa prochaine connexion.',
    });
  } catch (err) {
    console.error('[reinitialiserMotDePasse prof]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la réinitialisation.' });
  }
};

// ── DELETE /api/professeurs/:id ───────────────────────────────────────────────
exports.deleteProfesseur = async (req, res) => {
  const { id } = req.params;
  try {
    const pd = [id];
    await db.query(`UPDATE users SET statut='renvoye' WHERE id=$1 AND role='professeur'${etabCol(pd, req.etablissementId, 'etablissement_id')}`, pd);
    res.json({ message: 'Professeur désactivé.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/professeurs/:id ──────────────────────────────────────────────────
exports.getProfesseurById = async (req, res) => {
  try {
    const pg = [req.params.id];
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenoms, u.email, u.tel, u.role, u.domaine, u.statut,
              COALESCE(
                json_agg(
                  json_build_object('filiere_id', f.id, 'filiere_nom', f.nom, 'niveau', pf.niveau)
                  ORDER BY f.nom, pf.niveau
                ) FILTER (WHERE pf.id IS NOT NULL), '[]'
              ) AS affectations
       FROM users u
       LEFT JOIN professeur_filieres pf ON pf.professeur_id = u.id
       LEFT JOIN filieres f ON f.id = pf.filiere_id
       WHERE u.id=$1 AND u.role='professeur'${etabCol(pg, req.etablissementId, 'u.etablissement_id')}
       GROUP BY u.id, u.nom, u.prenoms, u.email, u.tel, u.role, u.domaine, u.statut`,
      pg
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Professeur non trouvé.' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── GET /api/professeurs/profile ──────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenoms, u.email, u.tel, u.role, u.domaine, u.statut,
              COALESCE(
                json_agg(
                  json_build_object('filiere_id', f.id, 'filiere_nom', f.nom, 'niveau', pf.niveau)
                  ORDER BY f.nom, pf.niveau
                ) FILTER (WHERE pf.id IS NOT NULL), '[]'
              ) AS affectations
       FROM users u
       LEFT JOIN professeur_filieres pf ON pf.professeur_id = u.id
       LEFT JOIN filieres f ON f.id = pf.filiere_id
       WHERE u.id=$1
       GROUP BY u.id, u.nom, u.prenoms, u.email, u.tel, u.role, u.domaine, u.statut`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Profil introuvable.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

// ── PUT /api/professeurs/profile ──────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  const { email, tel, domaine } = req.body;
  try {
    await db.query(
      `UPDATE users SET email=COALESCE($1,email), tel=COALESCE($2,tel), domaine=COALESCE($3,domaine)
       WHERE id=$4`,
      [email, tel, domaine, req.user.id]
    );
    const result = await db.query(
      `SELECT id, nom, prenoms, email, tel, domaine FROM users WHERE id=$1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── GET /api/professeurs/classes ──────────────────────────────────────────────
// Une ligne par (filière, niveau) affecté au prof — pas une ligne par filière —
// puisqu'un prof peut enseigner plusieurs niveaux d'une même filière.
exports.getClasses = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT f.id, f.nom, pf.niveau, f.domaine, COUNT(e.id)::int AS nb_etudiants
       FROM professeur_filieres pf
       JOIN filieres f ON f.id = pf.filiere_id
       LEFT JOIN etudiants e ON e.filiere_id = f.id AND e.niveau = pf.niveau
       WHERE pf.professeur_id = $1
       GROUP BY f.id, f.nom, pf.niveau, f.domaine
       ORDER BY f.nom, pf.niveau`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

// ── GET /api/professeurs/modules ──────────────────────────────────────────────
// ✅ CORRIGÉ — utilise désormais professeur_modules (affectation précise
// module+niveau+semestre), plus professeur_filieres (qui renvoyait TOUS les
// modules de la filière, même ceux que ce prof ne donne pas réellement).
exports.getModules = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pm.id AS affectation_id, m.id, m.nom, m.coefficient, m.volume_horaire,
              m.filiere_id, m.filiere_nom, pm.niveau, pm.semestre
       FROM professeur_modules pm
       JOIN modules m ON m.id = pm.module_id
       WHERE pm.professeur_id = $1
       ORDER BY m.filiere_nom, pm.niveau, pm.semestre, m.nom`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

// ── GET /api/professeurs/:id/modules ──────────────────────────────────────────
// ✅ CORRIGÉ — même correctif que ci-dessus, vue admin sur un prof précis.
exports.getModulesByProfesseur = async (req, res) => {
  try {
    if (!(await profDeMonEtab(req.params.id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Professeur non trouvé.' });
    }
    const result = await db.query(
      `SELECT pm.id AS affectation_id, m.id, m.nom, m.coefficient, m.volume_horaire,
              m.filiere_id, m.filiere_nom, pm.niveau, pm.semestre
       FROM professeur_modules pm
       JOIN modules m ON m.id = pm.module_id
       WHERE pm.professeur_id = $1
       ORDER BY m.filiere_nom, pm.niveau, pm.semestre, m.nom`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

// ── GET /api/professeurs/classes/:filiere_id/students?niveau=... ──────────────
// Le niveau est requis en query pour ne retourner que les étudiants du bon
// niveau (un prof peut enseigner plusieurs niveaux dans la même filière).
exports.getStudentsByFiliere = async (req, res) => {
  try {
    const { niveau } = req.query;
    const params = [req.params.filiere_id];
    let filtreNiveau = etabCol(params, req.etablissementId, 'e.etablissement_id');
    if (niveau) {
      params.push(niveau);
      filtreNiveau += ` AND e.niveau = $${params.length}`;
    }
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenoms, u.matricule, u.email, u.tel, u.statut, u.photo_url,
              (SELECT COUNT(*) FROM appel_presences ap WHERE ap.etudiant_id = e.id AND ap.statut = 'absent')::int AS total_absences
       FROM users u LEFT JOIN etudiants e ON e.user_id=u.id
       WHERE e.filiere_id=$1${filtreNiveau} AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%') ORDER BY u.nom`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

// ── GET /api/professeurs/classes/:filiere_id/students/pdf?niveau=... ──────────
// Génère la liste des étudiants d'une filière/niveau en PDF, imprimable ou
// téléchargeable directement depuis "Mes Classes" côté professeur. Le
// matricule figure ici (document officiel de liste de classe) même s'il
// reste masqué à l'écran dans l'app.
exports.getStudentsByFilierePdf = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { niveau, filiere_nom } = req.query;
    const params = [req.params.filiere_id];
    let filtreNiveau = etabCol(params, req.etablissementId, 'e.etablissement_id');
    if (niveau) {
      params.push(niveau);
      filtreNiveau += ` AND e.niveau = $${params.length}`;
    }
    const result = await db.query(
      `SELECT u.nom, u.prenoms, u.matricule
       FROM users u LEFT JOIN etudiants e ON e.user_id=u.id
       WHERE e.filiere_id=$1${filtreNiveau} AND (u.role ILIKE '%etudiant%' OR u.role ILIKE '%delegue%' OR u.role ILIKE '%bde%') ORDER BY u.nom`,
      params
    );
    const students = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=liste_etudiants.pdf');
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text('ScolarHub - Liste des étudiants', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').text(
      `Filière : ${filiere_nom || ''}    Niveau : ${niveau || 'Tous'}    Effectif : ${students.length}`,
      { align: 'center' }
    );
    doc.moveDown(1.5);

    doc.fontSize(11).font('Helvetica-Bold');
    const yHeader = doc.y;
    doc.text('N°', 50, yHeader, { width: 30 });
    doc.text('Nom & Prénoms', 90, yHeader, { width: 230 });
    doc.text('Matricule', 330, yHeader, { width: 150 });

    let y = yHeader + 18;
    doc.moveTo(50, y).lineTo(500, y).stroke();
    y += 12;

    doc.font('Helvetica').fontSize(10);
    students.forEach((s, i) => {
      if (y > 740) { doc.addPage(); y = 50; }
      doc.text(`${i + 1}`, 50, y, { width: 30 });
      doc.text(`${s.prenoms || ''} ${s.nom || ''}`, 90, y, { width: 230 });
      doc.text(`${s.matricule || ''}`, 330, y, { width: 150 });
      y += 20;
    });

    doc.end();
  } catch (err) {
    console.error('getStudentsByFilierePdf:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

// ── Disponibilités ────────────────────────────────────────────────────────────
exports.getDisponibilites = async (req, res) => {
  try {
    const r = await db.query('SELECT disponibilites FROM users WHERE id=$1', [req.user.id]);
    // Retourne { success, data } cohérent avec tous les autres endpoints
    const data = r.rows[0]?.disponibilites || [];
    res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

exports.getAllDisponibilites = async (req, res) => {
  try {
    const pdv = [];
    const r = await db.query(
      `SELECT id, nom, prenoms, disponibilites FROM users WHERE role='professeur' AND disponibilites IS NOT NULL${etabCol(pdv, req.etablissementId, 'etablissement_id')}`,
      pdv
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

exports.saveDisponibilites = async (req, res) => {
  try {
    // Flutter envoie { creneaux: [...] } (voir professor_service.dart)
    const creneaux = req.body.creneaux ?? req.body.disponibilites ?? [];
    await db.query('UPDATE users SET disponibilites=$1 WHERE id=$2', [JSON.stringify(creneaux), req.user.id]);
    res.json({ success: true, message: 'Disponibilités enregistrées.' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

// ── PATCH /api/professeurs/assign-module ──────────────────────────────────────
// ⚠️ Conservé pour compatibilité (ancien mécanisme, module_professeur sans
// niveau — "jamais renseignée" selon le commentaire d'origine). Préférer les
// nouveaux endpoints ci-dessous (assignerModule / retirerModule), qui
// capturent aussi le niveau et le semestre.
exports.patchModuleAssignment = async (req, res) => {
  const { module_id, professeur_id, action } = req.body;
  try {
    if (!(await profDeMonEtab(professeur_id, req.etablissementId))) {
      return res.status(404).json({ error: 'Professeur non trouvé.' });
    }
    if (action === 'assign') {
      await db.query('INSERT INTO module_professeur (module_id, professeur_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [module_id, professeur_id]);
    } else if (action === 'remove') {
      await db.query('DELETE FROM module_professeur WHERE module_id=$1 AND professeur_id=$2', [module_id, professeur_id]);
    } else {
      return res.status(400).json({ error: 'Action invalide.' });
    }
    res.json({ message: `Module ${action === 'assign' ? 'assigné' : 'retiré'} avec succès.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── POST /api/professeurs/:id/modules ─────────────────────────────────────────
// Affecte un module précis à un prof, pour un niveau et un semestre donnés.
// body: { module_id, filiere_id, niveau, semestre }
exports.assignerModule = async (req, res) => {
  const { id: professeurId } = req.params;
  const { module_id, filiere_id, niveau, semestre } = req.body;

  if (!module_id || !filiere_id || !niveau || !semestre) {
    return res.status(400).json({ success: false, message: 'module_id, filiere_id, niveau et semestre sont requis.' });
  }

  try {
    if (!(await profDeMonEtab(professeurId, req.etablissementId)) ||
        !(await filiereDeMonEtab(filiere_id, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Professeur ou filière introuvable.' });
    }
    const result = await db.query(
      `INSERT INTO professeur_modules (professeur_id, module_id, filiere_id, niveau, semestre)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (professeur_id, module_id, niveau) DO UPDATE SET semestre = EXCLUDED.semestre
       RETURNING id, professeur_id, module_id, filiere_id, niveau, semestre, created_at`,
      [professeurId, module_id, filiere_id, niveau, semestre]
    );

    // Crée (ou récupère) le sous-fil "Professeurs & Délégués" pour ce trio
    // (professeur, filiere, niveau) — un seul sous-fil qui regroupe tous les
    // modules de ce prof à ce niveau, peu importe combien sont affectés.
    // À la toute première création, les délégué(e)s/adjoint(e)s de ce
    // niveau sont ajoutés comme membres et notifiés.
    try {
      await getOrCreateCanalProfDelegue(professeurId, filiere_id, niveau);
    } catch (canalErr) {
      // Ne bloque pas l'affectation du module si la création du sous-fil échoue.
      console.error('[assignerModule] Erreur création sous-fil prof-délégué (non bloquante):', canalErr.message);
    }

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[assignerModule]', err);
    if (err.code === '23503') {
      return res.status(400).json({ success: false, message: 'Professeur, module ou filière introuvable.' });
    }
    res.status(500).json({ success: false, message: 'Erreur lors de l\'affectation du module.' });
  }
};

// ── DELETE /api/professeurs/:id/modules/:affectationId ────────────────────────
// Retire une affectation module précise (pas tout le prof, juste cette ligne).
// ── GET /api/professeurs/mes-canaux-coordination ──────────────────────────
// Liste des sous-fils "Professeurs & Délégués" (canaux type prof_delegue_niveau)
// où CE professeur est le titulaire — un par (filière, niveau) où il a au
// moins un module affecté (créés automatiquement par assignerModule, voir
// getOrCreateCanalProfDelegue). Groupés par filière pour l'écran messagerie.
exports.getMesCanauxCoordination = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id AS canal_id, c.filiere_id, f.nom AS filiere_nom, c.niveau
       FROM canaux c
       JOIN filieres f ON f.id = c.filiere_id
       WHERE c.type = 'prof_delegue_niveau' AND c.professeur_id = $1
       ORDER BY f.nom, c.niveau`,
      [req.user.id]
    );

    const parFiliere = {};
    for (const row of result.rows) {
      if (!parFiliere[row.filiere_id]) {
        parFiliere[row.filiere_id] = { filiere_id: row.filiere_id, filiere_nom: row.filiere_nom, niveaux: [] };
      }
      parFiliere[row.filiere_id].niveaux.push({ niveau: row.niveau, canal_id: row.canal_id });
    }

    res.json({ success: true, data: Object.values(parFiliere) });
  } catch (err) {
    console.error('[getMesCanauxCoordination]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des canaux de coordination.' });
  }
};

exports.retirerModule = async (req, res) => {
  const { id: professeurId, affectationId } = req.params;
  try {
    if (!(await profDeMonEtab(professeurId, req.etablissementId))) {
      return res.status(404).json({ success: false, message: 'Affectation non trouvée.' });
    }
    const result = await db.query(
      `DELETE FROM professeur_modules WHERE id = $1 AND professeur_id = $2 RETURNING id`,
      [affectationId, professeurId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Affectation non trouvée.' });
    }
    res.json({ success: true, message: 'Module retiré.' });
  } catch (err) {
    console.error('[retirerModule]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du retrait du module.' });
  }
};