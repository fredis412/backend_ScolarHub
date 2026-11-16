const pool = require('../config/db');
const { envoyerNotificationAuto } = require('./notifications.controller');

// ── Multi-établissement ─────────────────────────────────────────────────────
// req.etablissementId vient du jeton ; s'il est absent (anciens jetons), pas de filtre.
const etabMenu = (params, etabId) => {
  if (!etabId) return '';
  params.push(etabId);
  return ` AND etablissement_id = $${params.length}`;
};

const REPAS_VALIDES = ['petit_dejeuner', 'dejeuner', 'diner'];
const LABELS_REPAS = {
  petit_dejeuner: 'Petit-déjeuner',
  dejeuner: 'Déjeuner',
  diner: 'Dîner',
};
const CATEGORIES_VALIDES = ['plat_principal', 'entree', 'accompagnement', 'boisson', 'dessert'];

// ── Horaires et lieu de la cantine (réglables par l'admin) ───────────────────
const PARAMS_DEFAUT = { ouverture: '07:00', fermeture: '19:00', lieu: 'Restaurant universitaire' };

// Avant la migration (table absente) ou sans réglage enregistré : valeurs par défaut.
const lireParametres = async (etabId) => {
  try {
    const p = [];
    let f = ' WHERE etablissement_id IS NULL';
    if (etabId) { p.push(etabId); f = ' WHERE etablissement_id = $1'; }
    const r = await pool.query(`SELECT ouverture, fermeture, lieu FROM cantine_parametres${f} LIMIT 1`, p);
    return r.rows[0] ? { ...PARAMS_DEFAUT, ...r.rows[0] } : PARAMS_DEFAUT;
  } catch (e) {
    return PARAMS_DEFAUT;
  }
};

const COLONNES_PLAT = `id, date, repas, nom, description, categorie, prix, image_url, disponible, ordre`;

// GET /api/cantine/jour?date=YYYY-MM-DD (admin/cantinière)
// Renvoie les menus (état publié) ET les plats de la date, pour l'écran d'édition.
const getMenuJour = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const params = [date];
    const result = await pool.query(
      `SELECT id, date, repas, plats, publie, date_publication
       FROM cantine_menus WHERE date = $1${etabMenu(params, req.etablissementId)}`,
      params
    );
    const pp = [date];
    const plats = await pool.query(
      `SELECT ${COLONNES_PLAT} FROM cantine_plats
       WHERE date = $1${etabMenu(pp, req.etablissementId)}
       ORDER BY ordre, created_at`,
      pp
    );
    const parametres = await lireParametres(req.etablissementId);
    res.json({ success: true, date, data: result.rows, plats: plats.rows, parametres });
  } catch (err) {
    console.error('[getMenuJour]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du menu.' });
  }
};

// GET /api/cantine/aujourdhui (tous rôles connectés)
// Ne renvoie QUE les repas publiés du jour. Chaque plat du JSON publié porte
// désormais aussi description, categorie et image_url.
const getMenuAujourdhui = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const params = [today];
    const result = await pool.query(
      `SELECT repas, plats, date_publication
       FROM cantine_menus
       WHERE date = $1 AND publie = true${etabMenu(params, req.etablissementId)}
       ORDER BY CASE repas WHEN 'petit_dejeuner' THEN 1 WHEN 'dejeuner' THEN 2 ELSE 3 END`,
      params
    );
    const parametres = await lireParametres(req.etablissementId);
    res.json({ success: true, date: today, data: result.rows, parametres });
  } catch (err) {
    console.error('[getMenuAujourdhui]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du menu.' });
  }
};

// ── Validation d'un plat ────────────────────────────────────────────────────
const lirePlat = (body, partiel = false) => {
  const out = {};
  if (!partiel || body.nom !== undefined) {
    const nom = String(body.nom ?? '').trim();
    if (!nom) return { erreur: 'Le nom du plat est requis.' };
    out.nom = nom.slice(0, 120);
  }
  if (!partiel || body.prix !== undefined) {
    const prix = Number(body.prix);
    if (!Number.isFinite(prix) || prix < 0) return { erreur: 'Un prix valide est requis.' };
    out.prix = Math.round(prix);
  }
  if (body.description !== undefined) out.description = String(body.description ?? '').trim().slice(0, 300);
  if (body.categorie !== undefined) {
    if (!CATEGORIES_VALIDES.includes(body.categorie)) return { erreur: 'Catégorie invalide.' };
    out.categorie = body.categorie;
  }
  if (body.image_url !== undefined) out.image_url = body.image_url ? String(body.image_url) : null;
  if (body.disponible !== undefined) out.disponible = body.disponible === true || body.disponible === 'true';
  return { valeurs: out };
};

// PUT /api/cantine/parametres  { ouverture: 'HH:MM', fermeture: 'HH:MM', lieu }
const enregistrerParametres = async (req, res) => {
  try {
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    const ouverture = String(req.body.ouverture ?? '').trim();
    const fermeture = String(req.body.fermeture ?? '').trim();
    const lieu = String(req.body.lieu ?? '').trim().slice(0, 80);
    if (!hhmm.test(ouverture) || !hhmm.test(fermeture)) {
      return res.status(400).json({ success: false, message: 'Horaires invalides (format HH:MM).' });
    }
    if (ouverture >= fermeture) {
      return res.status(400).json({ success: false, message: "L'ouverture doit être avant la fermeture." });
    }
    if (!lieu) return res.status(400).json({ success: false, message: 'Le lieu est requis.' });

    const etabId = req.etablissementId || null;
    const p = [];
    const f = etabId ? (p.push(etabId), ' WHERE etablissement_id = $1') : ' WHERE etablissement_id IS NULL';
    const existant = await pool.query(`SELECT 1 FROM cantine_parametres${f}`, p);
    if (existant.rows.length > 0) {
      await pool.query(
        `UPDATE cantine_parametres SET ouverture = $${p.length + 1}, fermeture = $${p.length + 2}, lieu = $${p.length + 3}, updated_at = now()${f}`,
        [...p, ouverture, fermeture, lieu]
      );
    } else {
      await pool.query(
        `INSERT INTO cantine_parametres (etablissement_id, ouverture, fermeture, lieu) VALUES ($1, $2, $3, $4)`,
        [etabId, ouverture, fermeture, lieu]
      );
    }
    res.json({ success: true, message: 'Horaires enregistrés.', parametres: { ouverture, fermeture, lieu } });
  } catch (err) {
    console.error('[enregistrerParametres]', err);
    res.status(500).json({ success: false, message: "Erreur lors de l'enregistrement des horaires." });
  }
};

// POST /api/cantine/plats  { date, repas, nom, prix, description?, categorie?, image_url?, disponible? }
const creerPlat = async (req, res) => {
  try {
    const { date, repas } = req.body;
    if (!date || !REPAS_VALIDES.includes(repas)) {
      return res.status(400).json({ success: false, message: `date et repas (${REPAS_VALIDES.join(', ')}) sont requis.` });
    }
    const { valeurs, erreur } = lirePlat(req.body);
    if (erreur) return res.status(400).json({ success: false, message: erreur });
    const v = { description: '', categorie: 'plat_principal', image_url: null, disponible: true, ...valeurs };

    const ins = await pool.query(
      `INSERT INTO cantine_plats (date, repas, nom, description, categorie, prix, image_url, disponible, created_by, etablissement_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${COLONNES_PLAT}`,
      [date, repas, v.nom, v.description, v.categorie, v.prix, v.image_url, v.disponible, String(req.user.id), req.etablissementId || null]
    );
    res.status(201).json({ success: true, message: 'Plat ajouté.', data: ins.rows[0] });
  } catch (err) {
    console.error('[creerPlat]', err);
    res.status(500).json({ success: false, message: "Erreur lors de l'ajout du plat." });
  }
};

// PUT /api/cantine/plats/:id  (champs partiels)
const modifierPlat = async (req, res) => {
  try {
    const { valeurs, erreur } = lirePlat(req.body, true);
    if (erreur) return res.status(400).json({ success: false, message: erreur });
    const cles = Object.keys(valeurs);
    if (cles.length === 0) return res.status(400).json({ success: false, message: 'Rien à modifier.' });

    const params = [];
    const sets = cles.map((c) => { params.push(valeurs[c]); return `${c} = $${params.length}`; });
    params.push(req.params.id);
    const where = [`id = $${params.length}`];
    if (req.etablissementId) { params.push(req.etablissementId); where.push(`etablissement_id = $${params.length}`); }

    const up = await pool.query(
      `UPDATE cantine_plats SET ${sets.join(', ')}, updated_at = now()
       WHERE ${where.join(' AND ')} RETURNING ${COLONNES_PLAT}`,
      params
    );
    if (up.rows.length === 0) return res.status(404).json({ success: false, message: 'Plat introuvable.' });
    res.json({ success: true, message: 'Plat modifié.', data: up.rows[0] });
  } catch (err) {
    console.error('[modifierPlat]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la modification du plat.' });
  }
};

// DELETE /api/cantine/plats/:id
const supprimerPlat = async (req, res) => {
  try {
    const params = [req.params.id];
    const del = await pool.query(
      `DELETE FROM cantine_plats WHERE id = $1${etabMenu(params, req.etablissementId)} RETURNING id`,
      params
    );
    if (del.rows.length === 0) return res.status(404).json({ success: false, message: 'Plat introuvable.' });
    res.json({ success: true, message: 'Plat supprimé.' });
  } catch (err) {
    console.error('[supprimerPlat]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression du plat.' });
  }
};

// POST /api/cantine/plats/image  (multipart, champ « file ») → { url }
// Le middleware uploadToCloudinary a déjà envoyé le fichier : on renvoie l'URL.
const televerserImagePlat = (req, res) => {
  if (!req.uploadedFileUrl) {
    return res.status(400).json({ success: false, message: 'Aucune image reçue.' });
  }
  res.json({ success: true, url: req.uploadedFileUrl });
};

// Enregistre le menu publié (upsert) — sans ON CONFLICT : la clé unique peut
// être globale ou par établissement selon l'avancement de la migration.
const enregistrerMenuPublie = async (date, repas, plats, userId, etabId) => {
  const pe = [date, repas];
  const filtreEtab = etabMenu(pe, etabId);
  const existant = await pool.query(
    `SELECT id FROM cantine_menus WHERE date = $1 AND repas = $2${filtreEtab}`,
    pe
  );
  if (existant.rows.length > 0) {
    const up = await pool.query(
      `UPDATE cantine_menus SET plats = $1::jsonb, publie = true, publie_par = $2, date_publication = now()
       WHERE id = $3 RETURNING id`,
      [JSON.stringify(plats), userId, existant.rows[0].id]
    );
    return up.rows[0].id;
  }
  if (etabId) {
    const ins = await pool.query(
      `INSERT INTO cantine_menus (date, repas, plats, publie, publie_par, date_publication, etablissement_id)
       VALUES ($1, $2, $3::jsonb, true, $4, now(), $5) RETURNING id`,
      [date, repas, JSON.stringify(plats), userId, etabId]
    );
    return ins.rows[0].id;
  }
  const ins = await pool.query(
    `INSERT INTO cantine_menus (date, repas, plats, publie, publie_par, date_publication)
     VALUES ($1, $2, $3::jsonb, true, $4, now()) RETURNING id`,
    [date, repas, JSON.stringify(plats), userId]
  );
  return ins.rows[0].id;
};

// POST /api/cantine/publier (admin / cantinière)
// Nouveau : { date, repas } → publie les plats DISPONIBLES de ce repas (table cantine_plats).
// Ancien (toujours accepté) : { date, repas, plats: [{ nom, prix }] }.
// Un seul geste : enregistre ET publie ET notifie les étudiants actifs.
const publierMenu = async (req, res) => {
  try {
    const { date, repas } = req.body;
    let { plats } = req.body;
    if (!date || !REPAS_VALIDES.includes(repas)) {
      return res.status(400).json({
        success: false,
        message: `date et repas (${REPAS_VALIDES.join(', ')}) sont requis.`,
      });
    }

    const etabId = req.etablissementId || null;

    if (Array.isArray(plats) && plats.length > 0) {
      for (const p of plats) {
        if (!p.nom || typeof p.prix !== 'number') {
          return res.status(400).json({ success: false, message: 'Chaque plat doit avoir un nom et un prix numérique.' });
        }
      }
    } else {
      const pp = [date, repas];
      const rows = await pool.query(
        `SELECT id, nom, description, categorie, prix, image_url FROM cantine_plats
         WHERE date = $1 AND repas = $2 AND disponible = true${etabMenu(pp, etabId)}
         ORDER BY ordre, created_at`,
        pp
      );
      plats = rows.rows;
      if (plats.length === 0) {
        return res.status(400).json({ success: false, message: 'Ajoutez au moins un plat disponible avant de publier.' });
      }
    }

    const menuId = await enregistrerMenuPublie(date, repas, plats, req.user.id, etabId);

    // Notifier tous les étudiants actifs — non-bloquant.
    (async () => {
      try {
        const pu = [];
        let fu = '';
        if (etabId) { pu.push(etabId); fu = ` AND etablissement_id = $${pu.length}`; }
        const etusRes = await pool.query(
          `SELECT id FROM users
           WHERE (role ILIKE '%etudiant%' OR role ILIKE '%delegue%' OR role ILIKE '%bde%')
             AND COALESCE(statut, 'actif') NOT IN ('suspendu', 'renvoye', 'en_attente')${fu}`,
          pu
        );
        const titre = `Menu ${LABELS_REPAS[repas]} publié`;
        const corps = `Le menu du ${LABELS_REPAS[repas].toLowerCase()} est disponible : ${plats.map(p => p.nom).join(', ')}.`;
        for (const e of etusRes.rows) {
          await envoyerNotificationAuto(e.id, titre, corps, 'cantine', { date, repas });
        }
      } catch (notifErr) {
        console.error('[publierMenu] notification', notifErr.message);
      }
    })();

    res.json({ success: true, message: `Menu ${LABELS_REPAS[repas]} publié.`, id: menuId, nbPlats: plats.length });
  } catch (err) {
    console.error('[publierMenu]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la publication du menu.' });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// COMMANDES (panier → ticket). Paiement à la récupération, pas en ligne.
// ════════════════════════════════════════════════════════════════════════════
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const aujourdhui = () => new Date().toISOString().split('T')[0];
const deux = (n) => String(n).padStart(2, '0');

const mettreEnForme = (c, lignes) => {
  const d = new Date(c.created_at);
  return {
    id: c.id,
    ticket: c.ticket,
    numero: c.numero,
    date: c.date_commande instanceof Date ? c.date_commande.toISOString().split('T')[0] : String(c.date_commande).slice(0, 10),
    heure: `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}`,
    created_at: c.created_at,
    nom: c.nom || '',
    prenoms: c.prenoms || '',
    matricule: c.matricule || '',
    filiere: c.filiere_nom || '',
    niveau: c.niveau || '',
    total: c.total,
    statut: c.statut,
    traitee_at: c.traitee_at || null,
    lignes: lignes.map((l) => ({ repas: l.repas, nom: l.plat_nom, prix: l.prix, quantite: l.quantite })),
  };
};

const chargerAvecLignes = async (rows) => {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const l = await pool.query(
    `SELECT commande_id, repas, plat_nom, prix, quantite FROM cantine_commande_lignes WHERE commande_id = ANY($1::uuid[])`,
    [ids]
  );
  const parCommande = {};
  for (const x of l.rows) {
    if (!parCommande[x.commande_id]) parCommande[x.commande_id] = [];
    parCommande[x.commande_id].push(x);
  }
  return rows.map((r) => mettreEnForme(r, parCommande[r.id] || []));
};

// POST /api/cantine/commandes  { lignes: [{ repas, plat_id?, nom, quantite }] }
// Les prix viennent du menu publié du jour (jamais du client).
const passerCommande = async (req, res) => {
  try {
    const demandees = req.body.lignes;
    if (!Array.isArray(demandees) || demandees.length === 0 || demandees.length > 40) {
      return res.status(400).json({ success: false, message: 'Votre panier est vide.' });
    }

    const etuRes = await pool.query(
      `SELECT id, matricule, nom, prenoms, filiere_nom, niveau FROM etudiants WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (etuRes.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Seuls les étudiants peuvent commander.' });
    }
    const etu = etuRes.rows[0];

    const etabId = req.etablissementId || null;
    const today = aujourdhui();
    const pm = [today];
    const menus = await pool.query(
      `SELECT repas, plats FROM cantine_menus WHERE date = $1 AND publie = true${etabMenu(pm, etabId)}`,
      pm
    );
    const parRepas = {};
    for (const m of menus.rows) parRepas[m.repas] = Array.isArray(m.plats) ? m.plats : [];

    // Validation + regroupement des lignes identiques
    const retenues = new Map();
    for (const l of demandees) {
      const repas = String(l.repas || '');
      if (!REPAS_VALIDES.includes(repas)) {
        return res.status(400).json({ success: false, message: 'Repas invalide dans le panier.' });
      }
      const quantite = Math.round(Number(l.quantite));
      if (!Number.isFinite(quantite) || quantite < 1 || quantite > 10) {
        return res.status(400).json({ success: false, message: 'Quantité invalide (1 à 10 par plat).' });
      }
      const plats = parRepas[repas] || [];
      const nomDemande = String(l.nom || '').trim().toLowerCase();
      const plat = plats.find((p) => l.plat_id && p.id && String(p.id) === String(l.plat_id))
        || plats.find((p) => String(p.nom || '').trim().toLowerCase() === nomDemande);
      if (!plat) {
        return res.status(400).json({
          success: false,
          message: `« ${l.nom || 'Un plat'} » n'est plus au menu (${LABELS_REPAS[repas]}). Actualisez le menu.`,
        });
      }
      const cle = `${repas}|${plat.nom}`;
      const prev = retenues.get(cle);
      if (prev) prev.quantite = Math.min(10, prev.quantite + quantite);
      else retenues.set(cle, { repas, plat_nom: String(plat.nom), prix: Math.round(Number(plat.prix) || 0), quantite });
    }
    const lignes = [...retenues.values()];
    const total = lignes.reduce((s, l) => s + l.prix * l.quantite, 0);

    // NB : la couche base de données (execute_sql) n'accepte ni BEGIN/COMMIT ni verrous :
    // le numéro du jour est calculé dans l'INSERT lui-même, et un index unique + une nouvelle
    // tentative règlent le cas rarissime de deux commandes au même instant.
    let cmd = null;
    for (let essai = 0; essai < 6 && !cmd; essai++) {
      const params = [];
      const P = (v) => { params.push(v); return `$${params.length}`; };
      const dateP = P(today);
      const colonnes = ['numero', 'ticket', 'date_commande', 'user_id', 'matricule', 'nom', 'prenoms', 'filiere_nom', 'niveau', 'total'];
      const valeurs = [
        'x.n', `'T-' || LPAD(x.n::text, 3, '0')`, `${dateP}::date`, P(String(req.user.id)),
        P(etu.matricule ?? null), P(etu.nom ?? null), P(etu.prenoms ?? null), P(etu.filiere_nom ?? null), P(etu.niveau ?? null), P(total),
      ];
      let filtreEtab = '';
      if (etabId) {
        colonnes.push('etablissement_id');
        valeurs.push(P(etabId));
        filtreEtab = ` AND etablissement_id = ${P(etabId)}`;
      }
      try {
        const ins = await pool.query(
          `INSERT INTO cantine_commandes (${colonnes.join(', ')})
           SELECT ${valeurs.join(', ')}
           FROM (SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cantine_commandes WHERE date_commande = ${dateP}::date${filtreEtab}) x
           RETURNING *`,
          params
        );
        cmd = ins.rows[0] || null;
        if (!cmd) throw new Error('Commande non enregistrée.');
      } catch (e) {
        if (String(e.message).includes('23505') && essai < 5) continue; // numéro déjà pris : on recalcule
        throw e;
      }
    }

    // Lignes de la commande (une seule requête). En cas d'échec, on retire la commande orpheline.
    try {
      const params = [cmd.id];
      const tuples = lignes.map((l) => {
        params.push(l.repas, l.plat_nom, l.prix, l.quantite);
        const n = params.length;
        return `($1, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
      });
      await pool.query(
        `INSERT INTO cantine_commande_lignes (commande_id, repas, plat_nom, prix, quantite) VALUES ${tuples.join(', ')}`,
        params
      );
    } catch (e) {
      try { await pool.query(`DELETE FROM cantine_commandes WHERE id = $1`, [cmd.id]); } catch (_) { /* rien */ }
      throw e;
    }

    res.status(201).json({ success: true, message: `Commande ${cmd.ticket} enregistrée.`, data: mettreEnForme(cmd, lignes) });
  } catch (err) {
    console.error('[passerCommande]', err);
    res.status(500).json({ success: false, message: "Erreur lors de l'enregistrement de la commande." });
  }
};

// GET /api/cantine/mes-commandes  → mes commandes des 14 derniers jours
const getMesCommandes = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM cantine_commandes
       WHERE user_id = $1 AND created_at >= now() - interval '14 days'
       ORDER BY created_at DESC LIMIT 50`,
      [String(req.user.id)]
    );
    res.json({ success: true, data: await chargerAvecLignes(r.rows) });
  } catch (err) {
    console.error('[getMesCommandes]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement de vos commandes.' });
  }
};

// PATCH /api/cantine/commandes/:id/annuler  (l'étudiant, tant que la commande est en cours)
const annulerCommande = async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, message: 'Commande invalide.' });
    const r = await pool.query(
      `UPDATE cantine_commandes SET statut = 'annulee'
       WHERE id = $1 AND user_id = $2 AND statut = 'en_cours' RETURNING id`,
      [req.params.id, String(req.user.id)]
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ success: false, message: 'Cette commande ne peut plus être annulée.' });
    }
    res.json({ success: true, message: 'Commande annulée.' });
  } catch (err) {
    console.error('[annulerCommande]', err);
    res.status(500).json({ success: false, message: "Erreur lors de l'annulation." });
  }
};

// GET /api/cantine/commandes?statut=en_cours|traitee|annulee|toutes&date=YYYY-MM-DD  (admin)
// « en_cours » sans date : toutes les commandes non traitées, quel que soit le jour.
const getCommandes = async (req, res) => {
  try {
    const statut = ['en_cours', 'traitee', 'annulee', 'toutes'].includes(req.query.statut) ? req.query.statut : 'en_cours';
    const params = [];
    const where = [];
    if (statut !== 'toutes') { params.push(statut); where.push(`statut = $${params.length}`); }
    const date = req.query.date || (statut === 'en_cours' ? null : aujourdhui());
    if (date) { params.push(date); where.push(`date_commande = $${params.length}`); }
    if (req.etablissementId) { params.push(req.etablissementId); where.push(`etablissement_id = $${params.length}`); }

    const r = await pool.query(
      `SELECT * FROM cantine_commandes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at ${statut === 'en_cours' ? 'ASC' : 'DESC'} LIMIT 300`,
      params
    );

    const pc = [];
    let fc = '';
    if (req.etablissementId) { pc.push(req.etablissementId); fc = ' AND etablissement_id = $1'; }
    const c = await pool.query(`SELECT COUNT(*)::int AS n FROM cantine_commandes WHERE statut = 'en_cours'${fc}`, pc);

    res.json({ success: true, data: await chargerAvecLignes(r.rows), en_cours: c.rows[0].n });
  } catch (err) {
    console.error('[getCommandes]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des commandes.' });
  }
};

// PATCH /api/cantine/commandes/:id/traiter  (admin) : nourriture remise → sort de la liste « en cours »
const traiterCommande = async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, message: 'Commande invalide.' });
    const params = [String(req.user.id), req.params.id];
    const r = await pool.query(
      `UPDATE cantine_commandes SET statut = 'traitee', traitee_at = now(), traitee_par = $1
       WHERE id = $2 AND statut = 'en_cours'${etabMenu(params, req.etablissementId)} RETURNING id`,
      params
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ success: false, message: 'Commande introuvable ou déjà traitée.' });
    }
    res.json({ success: true, message: 'Commande traitée.' });
  } catch (err) {
    console.error('[traiterCommande]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du traitement de la commande.' });
  }
};

// POST /api/cantine/copier  { source: 'YYYY-MM-DD', cible: 'YYYY-MM-DD', repas?: 'dejeuner' }
// Reprend les plats d'un autre jour (menu deja prepare) vers la date cible.
// Ne publie rien : l'admin verifie puis publie. Les plats deja presents ce jour-la
// (meme repas + meme nom) ne sont pas dupliques.
const copierMenu = async (req, res) => {
  try {
    const { source, cible, repas } = req.body;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RE.test(String(source)) || !DATE_RE.test(String(cible))) {
      return res.status(400).json({ success: false, message: 'Dates invalides (format AAAA-MM-JJ).' });
    }
    if (source === cible) {
      return res.status(400).json({ success: false, message: 'Choisissez un autre jour que celui affiche.' });
    }
    if (repas && !REPAS_VALIDES.includes(repas)) {
      return res.status(400).json({ success: false, message: 'Repas invalide.' });
    }
    const etabId = req.etablissementId || null;

    const ps = [source];
    let filtreRepas = '';
    if (repas) { ps.push(repas); filtreRepas = ` AND repas = $${ps.length}`; }
    const src = await pool.query(
      `SELECT repas, nom, description, categorie, prix, image_url, ordre FROM cantine_plats
       WHERE date = $1${filtreRepas}${etabMenu(ps, etabId)}
       ORDER BY ordre, created_at`,
      ps
    );
    if (src.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Aucun plat a reprendre pour ce jour-la.' });
    }

    const pc = [cible];
    const deja = await pool.query(
      `SELECT repas, nom FROM cantine_plats WHERE date = $1${etabMenu(pc, etabId)}`,
      pc
    );
    const cle = (p) => `${p.repas}|${String(p.nom).trim().toLowerCase()}`;
    const existants = new Set(deja.rows.map(cle));
    const aCopier = src.rows.filter((p) => !existants.has(cle(p)));
    if (aCopier.length === 0) {
      return res.status(409).json({ success: false, message: 'Ces plats sont deja dans le menu de ce jour.' });
    }

    const params = [cible, String(req.user.id), etabId];
    const tuples = aCopier.map((p) => {
      params.push(p.repas, p.nom, p.description || '', p.categorie, p.prix, p.image_url || null, p.ordre ?? 0);
      const n = params.length;
      return `($1, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n}, true, $2, $3)`;
    });
    const ins = await pool.query(
      `INSERT INTO cantine_plats (date, repas, nom, description, categorie, prix, image_url, ordre, disponible, created_by, etablissement_id)
       VALUES ${tuples.join(', ')}
       RETURNING ${COLONNES_PLAT}`,
      params
    );

    const ignores = src.rows.length - aCopier.length;
    const msg = `${ins.rows.length} plat${ins.rows.length > 1 ? 's' : ''} repris`
      + (ignores > 0 ? ` (${ignores} deja present${ignores > 1 ? 's' : ''})` : '')
      + '. Verifiez puis publiez le menu.';
    res.status(201).json({ success: true, message: msg, data: ins.rows });
  } catch (err) {
    console.error('[copierMenu]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la reprise du menu.' });
  }
};

module.exports = {
  copierMenu,
  getMenuJour,
  getMenuAujourdhui,
  publierMenu,
  creerPlat,
  modifierPlat,
  supprimerPlat,
  televerserImagePlat,
  enregistrerParametres,
  passerCommande,
  getMesCommandes,
  annulerCommande,
  getCommandes,
  traiterCommande,
};