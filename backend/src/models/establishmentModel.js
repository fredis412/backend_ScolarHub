const supabase = require('../config/supabase');

/**
 * Modèle de données pour les Établissements / Campus (ex: IST Ouaga 2000)
 * Gère les interactions Supabase pour la configuration administrative de ScolarHub.
 */
const EstablishmentModel = {

  /**
   * Récupérer un établissement par son ID
   * @param {number|string} id - L'ID de l'établissement
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('etablissements')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(`[EstablishmentModel.findById] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Récupérer tous les établissements (campus) enregistrés
   */
  async findAll() {
    const { data, error } = await supabase
      .from('etablissements')
      .select('*')
      .order('nom', { ascending: true });
    
    if (error) {
      console.error(`[EstablishmentModel.findAll] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Créer un nouvel établissement
   * @param {Object} establishmentData - Données de l'établissement
   */
  async create(establishmentData) {
    const { data, error } = await supabase
      .from('etablissements')
      .insert([establishmentData])
      .select();
    
    if (error) {
      console.error(`[EstablishmentModel.create] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Modifier un établissement existant
   * @param {number|string} id - L'ID de l'établissement à modifier
   * @param {Object} establishmentData - Nouvelles données
   */
  async update(id, establishmentData) {
    const { data, error } = await supabase
      .from('etablissements')
      .update(establishmentData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[EstablishmentModel.update] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Supprimer un établissement
   * @param {number|string} id - L'ID de l'établissement à supprimer
   */
  async delete(id) {
    const { data, error } = await supabase
      .from('etablissements')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[EstablishmentModel.delete] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Requête spécifique : Récupérer tous les campus d'une ville/région donnée
   * @param {string} ville - Ville de recherche (ex: "Ouagadougou")
   */
  async findCampusesByCity(ville) {
    const { data, error } = await supabase
      .from('etablissements')
      .select('*')
      .ilike('adresse', `%${ville}%`);
    
    if (error) {
      console.error(`[EstablishmentModel.findCampusesByCity] Erreur :`, error.message);
      throw error;
    }
    return data;
  },
};

module.exports = EstablishmentModel;
