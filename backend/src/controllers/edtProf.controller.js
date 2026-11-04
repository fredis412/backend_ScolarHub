// GET /api/edt/professeur/planning  (professeur)
// Renvoie tous les créneaux des emplois du temps actifs (non archivés) de
// l'établissement où le champ « prof » correspond au professeur connecté.
// Le champ `prof` d'un créneau est un texte libre (nom saisi par l'admin) :
// la correspondance se fait sur le nom et les prénoms, sans accents ni
// majuscules, dans n'importe quel ordre.
const pool = require('../config/db');
const { normalizeNiveau } = require('../utils/filieres');

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\b(m|mr|mme|mlle|dr|pr|prof|professeur)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

const jetons = (s) => norm(s).split(' ').filter((t) => t.length > 1);

// Le créneau appartient au prof si tous les jetons de son NOM se retrouvent
// dans le champ prof ET qu'au moins un de ses prénoms y figure (si le champ
// prof ne contient que le nom de famille, on accepte aussi, tant que c'est
// le seul prof de ce nom — voir ambiguïté ci-dessous).
function correspond(profChamp, nom, prenoms) {
  const champ = jetons(profChamp);
  if (!champ.length) return false;
  const tNom = jetons(nom);
  const tPre = jetons(prenoms);
  if (!tNom.length) return false;
  if (!tNom.every((t) => champ.includes(t))) return false;
  if (!tPre.length) return true;
  const aPrenom = tPre.some((t) => champ.includes(t));
  // Champ « NOM » seul : accepté (cas courant des EDT papier).
  return aPrenom || champ.length === tNom.length;
}

const getMonProgramme = async (req, res) => {
  try {
    const u = await pool.query('SELECT nom, prenoms FROM users WHERE id = $1::uuid', [req.user.id]);
    const { nom, prenoms } = u.rows[0] || {};
    if (!nom) return res.json({ success: true, data: [] });

    // Homonymes : un autre professeur de l'établissement porte-t-il le même
    // nom ? Si oui, un créneau sans identifiant (ancien format) est ambigu et
    // n'est PAS attribué au hasard.
    const autres = await pool.query(
      `SELECT id, nom, prenoms FROM users
        WHERE role = 'professeur' AND id <> $1::uuid
          AND ($2::int IS NULL OR etablissement_id = $2::int)`,
      [req.user.id, req.etablissementId || null]
    );
    const homonymes = autres.rows.filter((o) => correspond(`${o.nom} ${o.prenoms}`, nom, prenoms));
    const homonyme = homonymes.length > 0;

    // Départage par les affectations (professeur_modules) : qui, parmi les
    // homonymes, enseigne CE module dans CETTE filière à CE niveau ?
    let affectations = [];
    if (homonyme) {
      const ids = [req.user.id, ...homonymes.map((h) => h.id)];
      const a = await pool.query(
        `SELECT pm.professeur_id::text AS pid, pm.filiere_id::text AS fid, pm.niveau, m.nom AS module
           FROM professeur_modules pm JOIN modules m ON m.id = pm.module_id
          WHERE pm.professeur_id = ANY($1::uuid[])`,
        [ids]
      );
      affectations = a.rows;
    }
    const enseigne = (pid, filiereId, niveauEdt, matiere) => affectations.some((x) =>
      x.pid === String(pid) &&
      x.fid === String(filiereId) &&
      normalizeNiveau(x.niveau) === normalizeNiveau(niveauEdt) &&
      (norm(x.module) === norm(matiere) || norm(matiere).includes(norm(x.module)) || norm(x.module).includes(norm(matiere))));

    const params = [];
    let cond = '';
    if (req.etablissementId) {
      params.push(req.etablissementId);
      cond = ` AND e.filiere IN (SELECT id FROM filieres WHERE etablissement_id = $1::int)`;
    }
    const r = await pool.query(
      `SELECT e.filiere, e.filiere_nom, e.niveau, e.creneaux
         FROM edt e
        WHERE COALESCE(e.archive, false) = false${cond}`,
      params
    );

    const out = [];
    for (const row of r.rows) {
      let cr = row.creneaux;
      if (typeof cr === 'string') { try { cr = JSON.parse(cr); } catch (_) { cr = []; } }
      if (!Array.isArray(cr)) continue;
      for (const c of cr) {
        if (!c) continue;
        if (c.prof_id) {
          // Créneau identifié : correspondance exacte, aucun doute possible.
          if (String(c.prof_id) !== String(req.user.id)) continue;
        } else {
          // Ancien créneau (nom en texte libre) : par le nom, sauf homonyme.
          if (!correspond(c.prof, nom, prenoms)) continue;
          if (homonyme) {
            // Moi seul parmi les homonymes dois enseigner ce module ici.
            const moi = enseigne(req.user.id, row.filiere, row.niveau, c.matiere);
            const autre = homonymes.some((h) => enseigne(h.id, row.filiere, row.niveau, c.matiere));
            if (!moi || autre) continue;
          }
        }
        out.push({
          jour: c.jour,
          heureDebut: c.heureDebut,
          heureFin: c.heureFin,
          matiere: c.matiere,
          salle: c.salle || '',
          type: c.type || 'cours',
          filiere_nom: row.filiere_nom || '',
          niveau: row.niveau || '',
        });
      }
    }
    res.json({ success: true, data: out });
  } catch (err) {
    console.error('[getMonProgramme]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
};

module.exports = { getMonProgramme };
