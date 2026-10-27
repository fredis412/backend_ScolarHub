// ════════════════════════════════════════════════════════════════════════
// GIFs — proxy vers l'API GIPHY (la clé ne doit jamais être exposée côté
// client, d'où ce passage par le backend).
// ⚠️ Nécessite GIPHY_API_KEY dans backend/.env — clé gratuite sur
// https://developers.giphy.com
// ════════════════════════════════════════════════════════════════════════

// GET /api/gifs/search?q=chat  (sans q → tendances du moment)
const rechercherGifs = async (req, res) => {
  const cle = process.env.GIPHY_API_KEY;
  if (!cle) {
    return res.status(500).json({
      success: false,
      message: 'GIPHY_API_KEY manquante côté serveur (voir backend/.env).',
    });
  }
  try {
    const { q } = req.query;
    const url = q && q.trim()
      ? `https://api.giphy.com/v1/gifs/search?api_key=${cle}&q=${encodeURIComponent(q.trim())}&limit=24&lang=fr&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${cle}&limit=24&rating=g`;

    const reponse = await fetch(url);
    const data = await reponse.json();

    const gifs = (data.data || []).map((g) => ({
      id: g.id,
      preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url || g.images?.original?.url,
      url: g.images?.fixed_width?.url || g.images?.original?.url,
    }));

    res.json({ success: true, data: gifs });
  } catch (error) {
    console.error('[rechercherGifs]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la recherche de GIF.' });
  }
};

module.exports = { rechercherGifs };
