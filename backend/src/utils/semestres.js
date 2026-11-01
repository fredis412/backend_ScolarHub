// backend/src/utils/semestres.js
// Le semestre appartient au MODULE (défini par l'administration). Le niveau s'en déduit.
const NIVEAU_SEMESTRES = {
  'Licence 1': [1, 2],
  'Licence 2': [3, 4],
  'Licence 3': [5, 6],
  'Master 1': [7, 8],
  'Master 2': [9, 10],
};

/** 3, '3' ou 'S3' → 3 ; sinon null (hors 1..10). */
const parseSemestre = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 10 ? n : null;
};

const niveauDuSemestre = (n) => {
  for (const [niv, sems] of Object.entries(NIVEAU_SEMESTRES)) if (sems.includes(n)) return niv;
  return null;
};

/** Le semestre n est-il cohérent avec ce niveau ? (niveau inconnu ou « Tous » : on ne bloque pas) */
const niveauCompatible = (niveau, n) => {
  if (!niveau || niveau === 'Tous' || !NIVEAU_SEMESTRES[niveau]) return true;
  return NIVEAU_SEMESTRES[niveau].includes(n);
};

module.exports = { NIVEAU_SEMESTRES, parseSemestre, niveauDuSemestre, niveauCompatible };
