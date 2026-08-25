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
// Returns { success: true } or { success: false, error: string }
const envoyerNotificationAuto = async (userId, titre, corps) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        titre,
        corps,
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
    pushToUser(userId, 'notification', data);

    return { success: true, data };
  } catch (error) {
    console.error('[envoyerNotificationAuto]', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  getNotifications,
  marquerCommeLue,
  marquerToutesLues,
  envoyerNotificationAuto,
};
