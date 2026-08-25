const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM membres WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'scolarhub_secret_key',
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createMembre = async (req, res) => {
  const { email, password, role, permissions } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO membres (email, password, role, permissions) VALUES ($1, $2, $3, $4) RETURNING id, email, role, permissions',
      [email, hashedPassword, role, JSON.stringify(permissions)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllMembres = async (req, res) => {
  try {
    const result = await db.query('SELECT id, email, role, permissions FROM membres');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatePermissions = async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  try {
    const result = await db.query(
      'UPDATE membres SET permissions = $1 WHERE id = $2 RETURNING id, email, role, permissions',
      [JSON.stringify(permissions), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Membre non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteMembre = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM membres WHERE id = $1', [id]);
    res.json({ message: 'Membre supprimé avec succès' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
