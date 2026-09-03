const pool = require('../config/db');
const bcrypt = require('bcryptjs');

// Cache des colonnes de la table parents
let _parentsColumns = null;
async function getParentsColumns() {
  if (_parentsColumns) return _parentsColumns;
  try {
    const res = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'parents' ORDER BY ordinal_position"
    );
    _parentsColumns = res.rows.map(r => r.column_name);
    console.log('[parents] Colonnes detectees:', _parentsColumns);
  } catch (e) {
    console.warn('[parents] Impossible de detecter les colonnes:', e.message);
    _parentsColumns = [];
  }
  return _parentsColumns;
}

const getParents = async (req, res) => {
  try {
    const cols = await getParentsColumns();
    let parents = [];

    if (cols.length > 0) {
      const hasMatriculeEnfant = cols.includes('matricule_enfant');
      const joinClause = hasMatriculeEnfant
        ? 'LEFT JOIN etudiants e ON p.matricule_enfant = e.matricule'
        : '';
      const etuCols = hasMatriculeEnfant
        ? ', e.nom AS etudiant_nom, e.prenoms AS etudiant_prenoms, e.filiere_nom, e.niveau'
        : '';

      try {
        const result = await pool.query(`
          SELECT p.* ${etuCols}
          FROM parents p
          ${joinClause}
          ORDER BY p.nom ASC
        `);
        parents = result.rows;
      } catch (err) {
        console.warn('[parents] Erreur requete parents:', err.message);
      }
    }

    // Fallback via etudiants.nom_parent
    if (parents.length === 0) {
      try {
        const fbResult = await pool.query(`
          SELECT DISTINCT
            e.nom_parent AS nom, '' AS prenoms, e.tel_parent AS telephone, e.email_parent AS email,
            'Parent' AS relation, e.matricule AS matricule_enfant,
            e.nom AS etudiant_nom, e.prenoms AS etudiant_prenoms,
            e.filiere_nom, e.niveau, false AS credentialsEnvoyes
          FROM etudiants e
          WHERE e.nom_parent IS NOT NULL AND e.nom_parent != ''
          ORDER BY e.nom_parent
        `);
        parents = fbResult.rows;
      } catch (fbErr) {
        console.warn('[parents] Fallback etudiants failed:', fbErr.message);
      }
    }

    res.json({ success: true, data: parents });
  } catch (err) {
    console.error('[parents.controller] GET /', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

const createParent = async (req, res) => {
  try {
    const { nom, prenoms, email, telephone, relation, matriculeEnfant, motDePasse } = req.body;

    console.log('[parents] createParent body:', { nom, prenoms, email, telephone, relation, matriculeEnfant });

    if (!nom || !prenoms || !matriculeEnfant) {
      return res.status(400).json({ success: false, message: 'Données manquantes (nom, prénoms et matricule enfant sont obligatoires).' });
    }

    const matriculeUp = matriculeEnfant.trim().toUpperCase().replace(/'/g, "''");
    const telClean = (telephone || '').trim().replace(/\s+/g, '');
    const nomUp = nom.trim().toUpperCase().replace(/'/g, "''");
    const prenomsSafe = prenoms.trim().replace(/'/g, "''");
    const emailVal = email?.trim() ? `'${email.trim().replace(/'/g, "''")}'` : 'NULL';
    const telVal = telClean ? `'${telClean.replace(/'/g, "''")}'` : 'NULL';

    // 1. Vérifier si l'étudiant existe
    const etuResult = await pool.query(
      `SELECT id, matricule FROM etudiants WHERE UPPER(matricule) = '${matriculeUp}'`
    );
    if (!etuResult.rows || etuResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Étudiant introuvable avec le matricule: ${matriculeEnfant}` });
    }
    const etudiantId = etuResult.rows[0].id;
    console.log('[parents] Étudiant trouvé, id:', etudiantId);

    // 2. Créer ou mettre à jour le compte utilisateur dans `users`
    // Le mot de passe est laissé à NULL (première connexion) pour que le parent le définisse lui-même
    let mdpSafe = 'NULL';
    if (motDePasse && motDePasse.trim() !== '') {
      const mdpHashe = await bcrypt.hash(motDePasse.trim(), 10);
      mdpSafe = `'${mdpHashe.replace(/'/g, "''")}'`;
    }

    let userId = null;

    // Vérifier si un utilisateur existe déjà par email ou téléphone
    if (email && email.trim() !== '') {
      try {
        const emailCheck = await pool.query(
          `SELECT id FROM users WHERE LOWER(email) = '${email.trim().toLowerCase().replace(/'/g, "''")}'`
        );
        if (emailCheck.rows && emailCheck.rows.length > 0) {
          userId = emailCheck.rows[0].id;
        }
      } catch (e) {
        console.warn('[parents] Vérification email:', e.message);
      }
    }

    if (!userId && telClean) {
      try {
        const telCheck = await pool.query(
          `SELECT id FROM users WHERE REPLACE(COALESCE(tel, ''), ' ', '') = '${telClean}'`
        );
        if (telCheck.rows && telCheck.rows.length > 0) {
          userId = telCheck.rows[0].id;
        }
      } catch (e) {
        console.warn('[parents] Vérification tel:', e.message);
      }
    }

    if (userId) {
      // Mettre à jour l'utilisateur existant
      console.log('[parents] Compte users existant réutilisé, mise à jour userId:', userId);
      try {
        await pool.query(`
          UPDATE users 
          SET nom = '${nomUp}', prenoms = '${prenomsSafe}', tel = ${telVal}, email = ${emailVal}, role = 'parent'
          WHERE id = '${userId}'
        `);
      } catch (uUpdateErr) {
        console.warn('[parents] Mise à jour users:', uUpdateErr.message);
      }
    } else {
      // Créer un nouveau compte utilisateur (mot_de_passe à NULL pour première connexion)
      const matriculeParent = `PAR-${Date.now().toString().slice(-6)}`;
      try {
        const userResult = await pool.query(
          `INSERT INTO users (matricule, nom, prenoms, email, tel, role, mot_de_passe, statut)
           VALUES ('${matriculeParent}', '${nomUp}', '${prenomsSafe}', ${emailVal}, ${telVal}, 'parent', ${mdpSafe}, 'actif')
           RETURNING id`
        );
        if (userResult.rows && userResult.rows.length > 0) {
          userId = userResult.rows[0].id;
          console.log('[parents] Nouveau compte users créé avec première connexion activée, userId:', userId);
        }
      } catch (userErr) {
        console.warn('[parents] Création users échouée:', userErr.message);
      }
    }

    // 3. Insérer dans la table parents (auto-détection colonnes)
    const cols = await getParentsColumns();
    console.log('[parents] Colonnes table parents:', cols);

    if (cols.length > 0) {
      const relationSafe = (relation || 'Parent').replace(/'/g, "''");

      const insertCols = [];
      const insertVals = [];

      const addCol = (colName, val) => {
        if (cols.includes(colName)) {
          insertCols.push(colName);
          insertVals.push(val);
        }
      };

      addCol('user_id', userId ? `'${userId}'` : 'NULL');
      addCol('nom', `'${nomUp}'`);
      addCol('prenoms', `'${prenomsSafe}'`);
      addCol('email', emailVal);
      addCol('telephone', telVal);
      addCol('relation', `'${relationSafe}'`);
      addCol('matricule_enfant', `'${matriculeUp}'`);
      addCol('etudiant_id', etudiantId !== null && etudiantId !== undefined ? `${etudiantId}` : 'NULL');

      if (insertCols.length > 0) {
        const insertQuery = `INSERT INTO parents (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})`;
        console.log('[parents] Insert query:', insertQuery);
        try {
          await pool.query(insertQuery);
          console.log('[parents] Insertion parents réussie.');
        } catch (insertErr) {
          console.error('[parents] Insertion parents échouée:', insertErr.message);
        }
      }
    }

    // 4. Mettre à jour l'étudiant
    const nomParentFull = (`${nom.trim().toUpperCase()} ${prenoms.trim()}`).replace(/'/g, "''");

    await pool.query(
      `UPDATE etudiants SET nom_parent = '${nomParentFull}', tel_parent = ${telVal}, email_parent = ${emailVal} WHERE UPPER(matricule) = '${matriculeUp}'`
    );

    console.log('[parents] Étudiant mis à jour avec les infos parent.');
    res.json({ success: true, message: 'Parent créé avec succès.' });

  } catch (err) {
    console.error('[parents.controller] POST / ERREUR:', err.message);
    console.error(err.stack);
    res.status(500).json({ success: false, message: `Erreur: ${err.message}` });
  }
};

module.exports = {
  getParents,
  createParent,
};
