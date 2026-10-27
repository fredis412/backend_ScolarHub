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

// GET /api/cantine/jour?date=YYYY-MM-DD (admin/cantinière)
// Renvoie les 3 repas de la date demandée (publiés ou non), pour l'écran
// d'édition — permet de préparer un menu à l'avance.
const getMenuJour = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const params = [date];
    const result = await pool.query(
      `SELECT id, date, repas, plats, publie, date_publication
       FROM cantine_menus WHERE date = $1${etabMenu(params, req.etablissementId)}`,
      params
    );
    res.json({ success: true, date, data: result.rows });
  } catch (err) {
    console.error('[getMenuJour]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du menu.' });
  }
};

// GET /api/cantine/aujourdhui (tous rôles connectés)
// Ne renvoie QUE les repas publiés du jour — c'est ce qu'affiche la fiche
// cantine de l'accueil étudiant.
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
    res.json({ success: true, date: today, data: result.rows });
  } catch (err) {
    console.error('[getMenuAujourdhui]', err);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du menu.' });
  }
};

// POST /api/cantine/publier (admin / cantinière)
// Body : { date, repas, plats: [{ nom, prix }] }
// Un seul geste : enregistre ET publie ET notifie tous les étudiants actifs
// — la cantinière "ne fait que publier le menu du jour", pas de brouillon
// séparé à gérer.
const publierMenu = async (req, res) => {
  try {
    const { date, repas, plats } = req.body;
    if (!date || !REPAS_VALIDES.includes(repas)) {
      return res.status(400).json({
        success: false,
        message: `date et repas (${REPAS_VALIDES.join(', ')}) sont requis.`,
      });
    }
    if (!Array.isArray(plats) || plats.length === 0) {
      return res.status(400).json({ success: false, message: 'Au moins un plat est requis.' });
    }
    for (const p of plats) {
      if (!p.nom || typeof p.prix !== 'number') {
        return res.status(400).json({ success: false, message: 'Chaque plat doit avoir un nom et un prix numérique.' });
      }
    }

    // Upsert manuel (sans ON CONFLICT) : la clé unique (date, repas) est globale
    // tant que la migration cantine n'est pas passée ; ainsi le code marche avant
    // et après, et chaque établissement a son propre menu.
    const etabId = req.etablissementId || null;
    const pe = [date, repas];
    const filtreEtab = etabMenu(pe, etabId);
    const existant = await pool.query(
      `SELECT id FROM cantine_menus WHERE date = $1 AND repas = $2${filtreEtab}`,
      pe
    );
    let menuId;
    if (existant.rows.length > 0) {
      const up = await pool.query(
        `UPDATE cantine_menus SET plats = $1::jsonb, publie = true, publie_par = $2, date_publication = now()
         WHERE id = $3 RETURNING id`,
        [JSON.stringify(plats), req.user.id, existant.rows[0].id]
      );
      menuId = up.rows[0].id;
    } else if (etabId) {
      const ins = await pool.query(
        `INSERT INTO cantine_menus (date, repas, plats, publie, publie_par, date_publication, etablissement_id)
         VALUES ($1, $2, $3::jsonb, true, $4, now(), $5) RETURNING id`,
        [date, repas, JSON.stringify(plats), req.user.id, etabId]
      );
      menuId = ins.rows[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO cantine_menus (date, repas, plats, publie, publie_par, date_publication)
         VALUES ($1, $2, $3::jsonb, true, $4, now()) RETURNING id`,
        [date, repas, JSON.stringify(plats), req.user.id]
      );
      menuId = ins.rows[0].id;
    }

    // Notifier tous les étudiants actifs — non-bloquant. Le menu est unique
    // pour tout l'établissement, pas scopé par filière.
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

    res.json({ success: true, message: `Menu ${LABELS_REPAS[repas]} publié.`, id: menuId });
  } catch (err) {
    console.error('[publierMenu]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la publication du menu.' });
  }
};

module.exports = {
  getMenuJour,
  getMenuAujourdhui,
  publierMenu,
};