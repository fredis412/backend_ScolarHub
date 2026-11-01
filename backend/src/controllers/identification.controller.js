// backend/src/controllers/identification.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// Identification AVANT connexion, sans code d'établissement.
//
//  GET /api/auth/identifier?matricule=24 IST-O2/ 1851
//      Étudiants. Retrouve l'établissement à partir du seul matricule :
//        1. le matricule existe déjà dans `users`  → on connaît l'école et l'état du compte ;
//        2. sinon, sa forme correspond au modèle d'UN seul établissement → on connaît l'école
//           (et on sait si l'auto-inscription y est ouverte).
//
//  GET /api/auth/espaces?nom=…&prenom=…&tel=…
//      Administration, professeurs, parents. Liste les « espaces » (établissement + rôle)
//      qui correspondent. Un seul → l'app continue comme avant ; plusieurs → l'app
//      affiche « Choisir mon espace ».
//
// Dans les deux cas, la suite (lookup, login, register) est INCHANGÉE : l'app renvoie
// simplement le `code_etablissement` obtenu ici, comme si l'utilisateur l'avait saisi.
// Rien de secret n'est renvoyé : nom/sigle/logo de l'école, rôle, état du compte.
// ─────────────────────────────────────────────────────────────────────────────
const pool = require('../config/db');
const { compilerModele } = require('../utils/matricule');

// « 24 IST-O2/ 1851 » → « 24IST-O2/1851 » (espaces, y compris insécables, retirés).
const normaliserMatricule = (s) => String(s || '').replace(/[\s ]+/g, '').toUpperCase();
const chiffres = (s) => String(s || '').replace(/\D/g, '');

// Limiteur en mémoire (par IP, et par téléphone pour les espaces).
const _essais = new Map();
function tropDeRequetes(cle, max, fenetreMs) {
  const now = Date.now();
  if (_essais.size > 5000) {
    for (const [k, v] of _essais) if (now - v.debut > fenetreMs) _essais.delete(k);
  }
  const e = _essais.get(cle);
  if (!e || now - e.debut > fenetreMs) {
    _essais.set(cle, { n: 1, debut: now });
    return false;
  }
  e.n += 1;
  return e.n > max;
}
const TROP = { message: 'Trop de tentatives. Réessayez dans quelques minutes.' };

const etabPublic = (e) => ({ code: e.code, nom: e.nom, sigle: e.sigle || '', logo_url: e.logo_url || '' });

const MSG = {
  inconnu: "Matricule non reconnu. Vérifiez-le, ou utilisez le code de votre établissement.",
  introuvable: "Ce matricule n'est pas encore enregistré. Rapprochez-vous de l'administration de votre établissement.",
  desactive: "Compte désactivé. Contactez l'administration.",
  attente: "Votre inscription est en attente de validation par l'administration.",
};

const identifierParMatricule = async (req, res) => {
  try {
    if (tropDeRequetes(`mat:${req.ip}`, 40, 10 * 60 * 1000)) return res.status(429).json(TROP);

    const mat = normaliserMatricule(req.query.matricule);
    if (mat.length < 4 || mat.length > 50) {
      return res.status(200).json({ found: false, etape: 'inconnu', message: MSG.inconnu });
    }

    // 1) Le matricule existe déjà (unique dans toute la base).
    const ur = await pool.query(
      `SELECT u.statut, u.etablissement_id,
              (u.mot_de_passe IS NOT NULL AND u.mot_de_passe <> '' AND u.mot_de_passe <> 'null') AS a_mdp
       FROM users u
       WHERE UPPER(REPLACE(u.matricule, ' ', '')) = $1
       LIMIT 1`,
      [mat]
    );
    const u = ur.rows[0];
    if (u && u.etablissement_id) {
      const er = await pool.query(
        `SELECT id, code, nom, sigle, logo_url FROM etablissements
         WHERE id = $1 AND COALESCE(actif, true) = true`,
        [u.etablissement_id]
      );
      const e = er.rows[0];
      if (!e) return res.status(200).json({ found: false, etape: 'inconnu', message: MSG.inconnu });
      let etape = 'mot_de_passe';
      if (u.statut === 'suspendu' || u.statut === 'renvoye') etape = 'desactive';
      else if (u.statut === 'en_attente') etape = 'attente';
      else if (!u.a_mdp) etape = 'activation';
      return res.status(200).json({
        found: true, etape, matricule: mat, etablissement: etabPublic(e), message: MSG[etape] || '',
      });
    }

    // 2) Matricule inconnu : on cherche l'établissement dont le modèle correspond.
    const all = await pool.query(
      `SELECT id, code, nom, sigle, logo_url, modele_matricule, inscription_ouverte
       FROM etablissements
       WHERE COALESCE(actif, true) = true AND COALESCE(modele_matricule, '') <> ''`
    );
    const candidats = all.rows.filter((e) => {
      const c = compilerModele(e.modele_matricule);
      return c && c.regex.test(mat);
    });
    // 0 ou plusieurs correspondances : on ne devine pas.
    if (candidats.length !== 1) {
      return res.status(200).json({ found: false, etape: 'inconnu', message: MSG.inconnu });
    }
    const e = candidats[0];
    const etape = e.inscription_ouverte === true ? 'inscription' : 'introuvable';
    return res.status(200).json({
      found: true, etape, matricule: mat, etablissement: etabPublic(e), message: MSG[etape] || '',
    });
  } catch (err) {
    console.error('identifierParMatricule error:', err);
    return res.status(500).json({ found: false, message: 'Erreur serveur.' });
  }
};

const espacesParPersonne = async (req, res) => {
  try {
    const nom = String(req.query.nom || '').trim();
    const prenom = String(req.query.prenom || req.query.prenoms || '').trim();
    const tel = chiffres(req.query.tel || req.query.telephone);
    if (!nom || !prenom || tel.length < 8) {
      return res.status(400).json({ found: false, message: 'Nom, prénom et téléphone requis.' });
    }
    const fin = tel.slice(-8); // numéros burkinabè : 8 chiffres, avec ou sans +226
    if (tropDeRequetes(`esp:${req.ip}`, 30, 10 * 60 * 1000) || tropDeRequetes(`espTel:${fin}`, 15, 10 * 60 * 1000)) {
      return res.status(429).json(TROP);
    }

    const r = await pool.query(
      String.raw`SELECT e.code, e.nom AS etab_nom, e.sigle, e.logo_url, u.role, u.admin_sub_role
       FROM users u JOIN etablissements e ON e.id = u.etablissement_id
       WHERE COALESCE(e.actif, true) = true
         AND COALESCE(u.statut, 'actif') NOT IN ('suspendu', 'renvoye', 'en_attente')
         AND LOWER(TRIM(u.nom)) = LOWER(TRIM($1))
         AND (LOWER(TRIM(u.prenoms)) = LOWER(TRIM($2)) OR LOWER(u.prenoms) LIKE '%' || LOWER(TRIM($2)) || '%')
         AND RIGHT(REGEXP_REPLACE(COALESCE(u.tel, ''), '\D', '', 'g'), 8) = $3
       UNION
       SELECT e.code, e.nom, e.sigle, e.logo_url, 'parent'::varchar, NULL::varchar
       FROM parents p JOIN etablissements e ON e.id = p.etablissement_id
       WHERE COALESCE(e.actif, true) = true
         AND p.user_id IS NULL
         AND LOWER(TRIM(p.nom)) = LOWER(TRIM($1))
         AND (LOWER(TRIM(p.prenoms)) = LOWER(TRIM($2)) OR LOWER(p.prenoms) LIKE '%' || LOWER(TRIM($2)) || '%')
         AND RIGHT(REGEXP_REPLACE(COALESCE(p.tel, ''), '\D', '', 'g'), 8) = $3`,
      [nom, prenom, fin]
    );

    // Un même couple (établissement, rôle) ne doit apparaître qu'une fois.
    const vus = new Set();
    const espaces = [];
    for (const row of r.rows) {
      const cle = `${row.code}|${row.role}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      espaces.push({
        code_etablissement: row.code,
        etablissement: { code: row.code, nom: row.etab_nom, sigle: row.sigle || '', logo_url: row.logo_url || '' },
        role: row.role,
        sous_role: row.admin_sub_role || null,
      });
    }
    if (!espaces.length) {
      return res.status(404).json({ found: false, espaces: [], message: 'Utilisateur non reconnu.' });
    }
    return res.status(200).json({ found: true, espaces });
  } catch (err) {
    console.error('espacesParPersonne error:', err);
    return res.status(500).json({ found: false, message: 'Erreur serveur.' });
  }
};

module.exports = { identifierParMatricule, espacesParPersonne, normaliserMatricule };
