// backend/src/controllers/ia.controller.js

const supabase = require('../config/supabase');
const pool = require('../config/db');

// pdf-parse est optionnel : sans lui, la révision se base sur titre/description du cours.
let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (_) {
  console.warn('[ia] pdf-parse non installé — révision IA sans extraction du texte des PDF.');
}

// POST /api/ia/chat - Envoyer un message à Claude
const chat = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Le message est requis.' });
    }
    const userId = req.user.id;

    // Récupérer les N derniers échanges pour le contexte
    const { data: historique } = await supabase
      .from('ia_conversations')
      .select('role, contenu')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(10);

    // Construire l'historique des messages
    const messages = historique
      ? historique.map((h) => ({ role: h.role, content: h.contenu }))
      : [];

    // Ajouter le nouveau message
    messages.push({ role: 'user', content: message });

    // Appel API Claude
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ success: false, message: 'Clé API Anthropic non configurée.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `Tu es un assistant IA intégré dans ScholARHub, 
                 une plateforme scolaire. Tu aides les étudiants, 
                 professeurs et parents avec leurs questions.`,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Anthropic API error:', response.status, errorBody);
      return res.status(502).json({ success: false, message: `Erreur API IA (${response.status}). Réessayez plus tard.` });
    }

    const data = await response.json();

    if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
      console.error('Unexpected Anthropic response format:', JSON.stringify(data));
      return res.status(502).json({ success: false, message: 'Réponse inattendue de l\'API IA.' });
    }

    const reponseIA = data.content[0].text;

    // Sauvegarder l'échange en base
    await supabase.from('ia_conversations').insert([
      { user_id: userId, role: 'user', contenu: message },
      { user_id: userId, role: 'assistant', contenu: reponseIA },
    ]);

    res.json({ success: true, reponse: reponseIA });
  } catch (error) {
    console.error('Erreur chat IA:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/ia/historique - Récupérer l'historique
const getHistorique = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;

    const { data, error } = await supabase
      .from('ia_conversations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({ success: true, historique: data.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Assistant de révision : quiz et fiches générés depuis les cours
// ─────────────────────────────────────────────────────────────

const appelerClaude = async (system, userContent, maxTokens = 2048) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, status: 503, error: 'Clé API Anthropic non configurée.' };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Anthropic API error:', response.status, errorBody);
    return { ok: false, status: 502, error: `Erreur API IA (${response.status}).` };
  }
  const data = await response.json();
  if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
    return { ok: false, status: 502, error: 'Réponse inattendue de l\'API IA.' };
  }
  return { ok: true, text: data.content[0].text };
};

// Récupère le texte d'un support de cours (PDF si possible, sinon métadonnées).
const extraireContenuCours = async (support) => {
  let texte = '';
  if (pdfParse && support.fichier_url && support.fichier_url.toLowerCase().includes('.pdf')) {
    try {
      const response = await fetch(support.fichier_url);
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const parsed = await pdfParse(buffer);
        texte = (parsed.text || '').slice(0, 30000); // limite de contexte
      }
    } catch (err) {
      console.warn('[extraireContenuCours]', err.message);
    }
  }
  return texte;
};

// GET /api/ia/supports - Supports de cours de la filière de l'étudiant connecté
const getSupportsRevision = async (req, res) => {
  try {
    const etudiantResult = await pool.query(
      `SELECT filiere_id, niveau FROM etudiants WHERE user_id = $1`,
      [req.user.id],
    );
    const etudiant = etudiantResult.rows[0];
    if (!etudiant) {
      return res.status(404).json({ success: false, message: 'Profil étudiant non trouvé.' });
    }
    const result = await pool.query(`
      SELECT sc.id, sc.titre, sc.description, sc.niveau, sc.fichier_url,
             sc.date_creation, m.nom AS module_nom
      FROM supports_cours sc
      JOIN modules m ON m.id = sc.module_id
      WHERE sc.filiere_id = $1
      ORDER BY sc.date_creation DESC
    `, [etudiant.filiere_id]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[getSupportsRevision]', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des cours.' });
  }
};

// POST /api/ia/revision - Génère un quiz ou une fiche de révision depuis un cours
// body: { support_id, type: 'quiz' | 'fiche' }
const genererRevision = async (req, res) => {
  try {
    const { support_id, type } = req.body;
    if (!support_id || !['quiz', 'fiche'].includes(type)) {
      return res.status(400).json({ success: false, message: 'support_id et type (quiz|fiche) sont requis.' });
    }

    const supportResult = await pool.query(`
      SELECT sc.*, m.nom AS module_nom FROM supports_cours sc
      JOIN modules m ON m.id = sc.module_id
      WHERE sc.id = $1
    `, [support_id]);
    const support = supportResult.rows[0];
    if (!support) {
      return res.status(404).json({ success: false, message: 'Support de cours non trouvé.' });
    }

    const contenu = await extraireContenuCours(support);
    const contexte = contenu
      ? `Contenu du cours :\n${contenu}`
      : `Le texte du cours n'est pas disponible. Base-toi sur le sujet : module "${support.module_nom}", cours "${support.titre}"${support.description ? `, description : ${support.description}` : ''}.`;

    if (type === 'quiz') {
      const result = await appelerClaude(
        `Tu es un professeur qui crée des quiz de révision pour des étudiants.
Tu réponds UNIQUEMENT avec un JSON valide, sans texte autour, au format :
{"questions":[{"question":"...","choix":["A","B","C","D"],"bonne_reponse":0,"explication":"..."}]}
Génère exactement 5 questions à choix multiples en français, du niveau du cours fourni.
"bonne_reponse" est l'index (0-3) du bon choix dans "choix".`,
        `Cours : "${support.titre}" (module ${support.module_nom}).\n${contexte}`,
      );
      if (!result.ok) {
        return res.status(result.status).json({ success: false, message: result.error });
      }
      // Extraction robuste du JSON (l'IA peut entourer de ```json)
      const match = result.text.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(502).json({ success: false, message: 'Le quiz généré est illisible. Réessayez.' });
      }
      let quiz;
      try {
        quiz = JSON.parse(match[0]);
      } catch (_) {
        return res.status(502).json({ success: false, message: 'Le quiz généré est illisible. Réessayez.' });
      }
      return res.json({ success: true, type: 'quiz', titre: support.titre, module: support.module_nom, quiz });
    }

    // type === 'fiche'
    const result = await appelerClaude(
      `Tu es un professeur qui rédige des fiches de révision synthétiques pour des étudiants.
Rédige en français, en Markdown : titres, points clés, définitions à retenir, et 3 questions
ouvertes d'auto-évaluation à la fin. Sois concis et pédagogique.`,
      `Rédige la fiche de révision du cours : "${support.titre}" (module ${support.module_nom}).\n${contexte}`,
    );
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.error });
    }
    res.json({ success: true, type: 'fiche', titre: support.titre, module: support.module_nom, fiche: result.text });
  } catch (error) {
    console.error('[genererRevision]', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la génération.' });
  }
};

module.exports = { chat, getHistorique, getSupportsRevision, genererRevision };