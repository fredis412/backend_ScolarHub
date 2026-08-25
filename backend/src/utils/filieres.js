const FILIERES_DEFAUT = [
  { nom: 'Réseaux Informatiques et Télécom', description: 'Réseaux, télécoms et informatique' },
  { nom: 'Électrotechnique', description: 'Électrotechnique et électronique' },
  { nom: 'Marketing & Communication', description: 'Marketing et communication' },
  { nom: 'Gestion Comptable et Financière', description: 'Comptabilité et gestion financière' },
  { nom: 'Génie Civil', description: 'Génie civil et BTP' },
  { nom: 'Finance Comptabilité', description: 'Finance et comptabilité' },
];

const ensureFilieres = async (client) => {
  for (const f of FILIERES_DEFAUT) {
    const exists = await client.query('SELECT id FROM filieres WHERE nom = $1', [f.nom]);
    if (exists.rows.length === 0) {
      await client.query('INSERT INTO filieres (nom, description) VALUES ($1, $2)', [f.nom, f.description]);
    }
  }
};

const getFiliereNomById = async (db, filiereId) => {
  if (!filiereId) return null;
  const r = await db.query('SELECT nom FROM filieres WHERE id = $1', [filiereId]);
  return r.rows[0]?.nom || null;
};

const resolveFiliere = async (db, filiereValue) => {
  if (!filiereValue) return { id: null, nom: null };
  const asId = parseInt(filiereValue, 10);
  if (!Number.isNaN(asId)) {
    const nom = await getFiliereNomById(db, asId);
    return { id: asId, nom };
  }
  const r = await db.query('SELECT id, nom FROM filieres WHERE nom = $1', [String(filiereValue).trim()]);
  if (r.rows[0]) return { id: r.rows[0].id, nom: r.rows[0].nom };
  return { id: null, nom: String(filiereValue).trim() };
};

module.exports = { FILIERES_DEFAUT, ensureFilieres, getFiliereNomById, resolveFiliere };
