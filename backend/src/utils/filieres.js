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

const ACRONYMS = {
  'rit': 1,
  'reseau': 1,
  'reseaux': 1,
  'elt': 2,
  'electro': 2,
  'mc': 3,
  'marketing': 3,
  'com': 3,
  'gcf': 4,
  'compta': 4,
  'gc': 5,
  'genie': 5,
  'fc': 6,
  'finance': 6,
};

const resolveFiliere = async (db, filiereValue) => {
  if (!filiereValue) return { id: null, nom: null };
  const str = String(filiereValue).trim();
  const asId = parseInt(str, 10);
  if (!Number.isNaN(asId)) {
    const nom = await getFiliereNomById(db, asId);
    return { id: asId, nom };
  }

  const clean = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ACRONYMS[clean]) {
    const id = ACRONYMS[clean];
    const nom = await getFiliereNomById(db, id);
    return { id, nom };
  }

  // Exact match
  const rExact = await db.query('SELECT id, nom FROM filieres WHERE LOWER(nom) = LOWER($1)', [str]);
  if (rExact.rows[0]) return { id: rExact.rows[0].id, nom: rExact.rows[0].nom };

  // ILIKE match
  const rLike = await db.query('SELECT id, nom FROM filieres WHERE nom ILIKE $1 OR $1 ILIKE nom', [`%${str}%`]);
  if (rLike.rows[0]) return { id: rLike.rows[0].id, nom: rLike.rows[0].nom };

  return { id: null, nom: str };
};

const normalizeNiveau = (niveau) => {
  if (!niveau) return null;
  const n = String(niveau).trim().toUpperCase();
  if (n === 'L1' || n === 'LICENCE 1' || n === 'LICENCE1') return 'Licence 1';
  if (n === 'L2' || n === 'LICENCE 2' || n === 'LICENCE2') return 'Licence 2';
  if (n === 'L3' || n === 'LICENCE 3' || n === 'LICENCE3') return 'Licence 3';
  if (n === 'M1' || n === 'MASTER 1' || n === 'MASTER1') return 'Master 1';
  if (n === 'M2' || n === 'MASTER 2' || n === 'MASTER2') return 'Master 2';
  return String(niveau).trim();
};

module.exports = { FILIERES_DEFAUT, ensureFilieres, getFiliereNomById, resolveFiliere, normalizeNiveau };
