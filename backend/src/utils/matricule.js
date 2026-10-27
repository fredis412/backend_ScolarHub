// backend/src/utils/matricule.js
// ─────────────────────────────────────────────────────────────────────────────
// Matricules par établissement.
//
// Chaque établissement définit UNE FOIS son modèle (colonne
// etablissements.modele_matricule). Jetons reconnus :
//   {AA}    année d'arrivée sur 2 chiffres   (24)
//   {AAAA}  année d'arrivée sur 4 chiffres   (2024)
//   {NNNN}  numéro d'ordre, zéros à gauche   (0987) — au moins autant de
//           chiffres qu'il y a de N ; davantage si le compteur dépasse.
// Tout le reste est du texte fixe, réservé à l'établissement.
//   Exemple IST :  {AA}IST-O2/{NNNN}   →   24IST-O2/1851
//
// Le numéro suivant = (plus grand numéro déjà utilisé dans l'établissement) + 1.
// Les anciens matricules saisis à la main sont donc pris en compte tout seuls.
// ─────────────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compilerModele(modele) {
  const m = String(modele || '').trim();
  if (!m) return null;
  const re = /\{(AAAA|AA|N+)\}/g;
  let rx = '^';
  let last = 0;
  let groupes = 0;
  let numGroupe = 0;
  let largeur = 0;
  const parts = [];
  let t;
  while ((t = re.exec(m))) {
    const lit = m.slice(last, t.index);
    rx += esc(lit);
    parts.push({ lit });
    groupes += 1;
    if (t[1] === 'AA') { rx += '(\\d{2})'; parts.push({ annee: 2 }); }
    else if (t[1] === 'AAAA') { rx += '(\\d{4})'; parts.push({ annee: 4 }); }
    else {
      rx += `(\\d{${t[1].length},})`;
      parts.push({ num: t[1].length });
      numGroupe = groupes;
      largeur = t[1].length;
    }
    last = re.lastIndex;
  }
  const fin = m.slice(last);
  rx += `${esc(fin)}$`;
  parts.push({ lit: fin });
  if (!numGroupe) return null; // pas de numéro d'ordre : modèle inutilisable
  // Texte fixe (hors jetons) : au moins 2 caractères pour identifier l'école.
  const fixe = parts.filter((p) => p.lit).map((p) => p.lit).join('');
  return { modele: m, regex: new RegExp(rx, 'i'), parts, numGroupe, largeur, fixe };
}

// Vérifie qu'un modèle est exploitable avant de l'enregistrer.
function modeleValide(modele) {
  const c = compilerModele(modele);
  if (!c) return { ok: false, message: "Le modèle doit contenir un numéro d'ordre, ex. {NNNN}." };
  if (c.fixe.replace(/[^A-Za-z0-9]/g, '').length < 2) {
    return { ok: false, message: "Le modèle doit contenir des caractères fixes propres à l'établissement (ex. IST-O2/)." };
  }
  return { ok: true };
}

// Contrôle une saisie manuelle. Sans modèle défini : on accepte (anciens comportements).
function validerMatricule(modele, matricule) {
  const c = compilerModele(modele);
  if (!c) return { ok: true };
  if (c.regex.test(String(matricule || '').trim())) return { ok: true };
  return { ok: false, message: `Le matricule ne respecte pas le modèle de l'établissement (${c.modele}).` };
}

// Prochain matricule libre. `client` : pool ou client avec .query().
async function genererProchainMatricule(client, etabId, opts = {}) {
  if (!etabId) {
    const e = new Error("Établissement inconnu : reconnectez-vous puis réessayez.");
    e.code = 'NO_ETAB';
    throw e;
  }
  const er = await client.query('SELECT modele_matricule FROM etablissements WHERE id = $1', [etabId]);
  const c = compilerModele(er.rows[0]?.modele_matricule);
  if (!c) {
    const e = new Error("Le modèle de matricule de l'établissement n'est pas encore défini.");
    e.code = 'NO_MODELE';
    throw e;
  }
  const rows = await client.query(
    'SELECT matricule FROM users WHERE etablissement_id = $1 AND matricule IS NOT NULL',
    [etabId]
  );
  let max = 0;
  for (const r of rows.rows) {
    const mt = c.regex.exec(String(r.matricule));
    if (mt) {
      const n = parseInt(mt[c.numGroupe], 10);
      if (n > max) max = n;
    }
  }
  const annee = parseInt(opts.anneeEntree, 10) || new Date().getFullYear();
  let num = max + 1;
  for (let i = 0; i < 50; i += 1, num += 1) {
    const m = c.parts.map((p) => {
      if (p.lit !== undefined) return p.lit;
      if (p.annee === 2) return String(annee % 100).padStart(2, '0');
      if (p.annee === 4) return String(annee);
      return String(num).padStart(p.num, '0');
    }).join('').toUpperCase();
    const ex = await client.query('SELECT 1 FROM users WHERE matricule = $1', [m]);
    if (!ex.rows.length) return m;
  }
  throw new Error('Impossible de générer un matricule libre.');
}

module.exports = { compilerModele, modeleValide, validerMatricule, genererProchainMatricule };
