const supabase = require('../config/supabase');
const { pushToUser } = require('../socket/socketHandler');

// GET /api/notifications - Liste des notifications de l'utilisateur
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, notifications: data || [] });
  } catch (error) {
    console.error('[getNotifications]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/notifications/non-lues/count - Nombre de notifications non lues.
// Léger, dédié à la cloche (badge rouge) — évite de charger toute la liste
// juste pour afficher un chiffre.
const getNombreNonLues = async (req, res) => {
  try {
    const userId = req.user.id;

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('lue', false);

    if (error) throw error;

    res.json({ success: true, count: count || 0 });
  } catch (error) {
    console.error('[getNombreNonLues]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/notifications/:id/lue - Marquer une notification comme lue
const marquerCommeLue = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('notifications')
      .update({ lue: true })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true, message: 'Notification marquee comme lue' });
  } catch (error) {
    console.error('[marquerCommeLue]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/notifications/lire-tout - Marquer toutes comme lues
const marquerToutesLues = async (req, res) => {
  try {
    const userId = req.user.id;

    const { error } = await supabase
      .from('notifications')
      .update({ lue: true })
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true, message: 'Toutes les notifications marquees comme lues' });
  } catch (error) {
    console.error('[marquerToutesLues]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Utilitaire - Enregistrer une notification
// [type] identifie la catégorie d'événement (ex. 'edt', 'note', 'bulletin',
// 'cours', 'mot_de_passe', 'premiere_connexion', 'nouvel_etudiant',
// 'annonce') — utilisé côté Flutter pour choisir l'icône ET pour savoir
// où rediriger au clic.
// [data] porte le contexte nécessaire à cette redirection (ex.
// { tab: 'planning' }, { etudiantId }, { canalId }...). Optionnel.
// Returns { success: true } or { success: false, error: string }
const envoyerNotificationAuto = async (userId, titre, corps, type = null, data = null) => {
  try {
    const { data: row, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        titre,
        corps,
        type,
        data,
        lue: false,
        created_at: new Date(),
      })
      .select()
      .single();

    if (error) {
      console.error('[envoyerNotificationAuto]', error);
      return { success: false, error: error.message };
    }

    // Push temps réel vers la cloche de l'utilisateur (si connecté).
    pushToUser(userId, 'notification', row);

    return { success: true, data: row };
  } catch (error) {
    console.error('[envoyerNotificationAuto]', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  getNotifications,
  getNombreNonLues,
  marquerCommeLue,
  marquerToutesLues,
  envoyerNotificationAuto,
};