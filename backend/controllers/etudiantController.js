const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Connexion Étudiant (via matricule)
exports.loginEtudiant = async (req, res) => {
  const { matricule, password } = req.body;
  try {
    if (!matricule) {
      return res.status(400).json({ error: 'Le matricule est obligatoire' });
    }

    const result = await db.query('SELECT * FROM etudiants WHERE UPPER(matricule) = $1', [matricule.toUpperCase()]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Matricule non reconnu' });
    }

    const student = result.rows[0];

    // Si c'est la première fois ou s'il n'a pas encore de mot de passe dans la BDD
    if (!student.password || student.premierefois) {
      // Si un mot de passe a quand même été soumis (ex: lors de la finalisation), ou connexion sans mdp
      if (!password || password.trim() === '') {
        return res.json({ 
          message: 'Première connexion détectée. Veuillez compléter vos informations.', 
          premiereFois: true,
          student: {
            id: student.id,
            matricule: student.matricule,
            nom: student.nom,
            prenoms: student.prenoms,
            email: student.email || '',
            telephone: student.telephone || '',
            filiere_id: student.filiere_id,
            filiere: student.filiere || '',
            niveau: student.niveau || ''
          }
        });
      }
    }

    // Si le mot de passe est présent en BDD, le mot de passe est obligatoire
    if (!password || password.trim() === '') {
      return res.status(400).json({ error: 'Veuillez saisir votre mot de passe' });
    }

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    const token = jwt.sign(
      { id: student.id, role: 'etudiant' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: student.id,
        matricule: student.matricule,
        nom: student.nom,
        prenoms: student.prenoms,
        email: student.email,
        telephone: student.telephone,
        role: 'etudiant',
        filiere_id: student.filiere_id
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Finaliser l'inscription (Première fois)
exports.finaliserInscription = async (req, res) => {
  const { id, matricule, email, telephone, password } = req.body;
  try {
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let result;

    if (id) {
      result = await db.query(
        'UPDATE etudiants SET email = COALESCE($1, email), telephone = COALESCE($2, telephone), password = $3, premierefois = FALSE WHERE id = $4 RETURNING *',
        [email, telephone, hashedPassword, id]
      );
    } else if (matricule) {
      result = await db.query(
        'UPDATE etudiants SET email = COALESCE($1, email), telephone = COALESCE($2, telephone), password = $3, premierefois = FALSE WHERE UPPER(matricule) = $4 RETURNING *',
        [email, telephone, hashedPassword, matricule.toUpperCase()]
      );
    } else {
      return res.status(400).json({ error: 'ID ou matricule requis pour finaliser l\'inscription' });
    }
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Étudiant non trouvé' });
    
    const student = result.rows[0];
    const token = jwt.sign(
      { id: student.id, role: 'etudiant' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Compte activé avec succès',
      token,
      user: {
        id: student.id,
        matricule: student.matricule,
        nom: student.nom,
        prenoms: student.prenoms,
        email: student.email,
        telephone: student.telephone,
        role: 'etudiant',
        filiere_id: student.filiere_id
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
