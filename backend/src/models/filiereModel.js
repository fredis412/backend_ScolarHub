const supabase = require('../config/supabase');

/**
 * Modèle de données pour les Filières / Programmes Académiques
 * Gère les interactions Supabase pour la table 'filieres'.
 */
const FiliereModel = {

  /**
   * Récupérer une filière par son ID
   * @param {number|string} id - L'ID de la filière
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('filieres')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(`[FiliereModel.findById] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Récupérer toutes les filières
   */
  async findAll() {
    const { data, error } = await supabase
      .from('filieres')
      .select('*')
      .order('nom', { ascending: true });
    
    if (error) {
      console.error(`[FiliereModel.findAll] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Créer une nouvelle filière
   * @param {Object} filiereData - Données de la filière
   */
  async create(filiereData) {
    const { data, error } = await supabase
      .from('filieres')
      .insert([filiereData])
      .select();
    
    if (error) {
      console.error(`[FiliereModel.create] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Mettre à jour une filière existante
   * @param {number|string} id - L'ID de la filière à modifier
   * @param {Object} filiereData - Données à mettre à jour
   */
  async update(id, filiereData) {
    const { data, error } = await supabase
      .from('filieres')
      .update(filiereData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[FiliereModel.update] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Supprimer une filière
   * @param {number|string} id - L'ID de la filière à supprimer
   */
  async delete(id) {
    const { data, error } = await supabase
      .from('filieres')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[FiliereModel.delete] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Requête spécifique : Obtenir les statistiques rapides d'une filière
   * Récupère le nombre de modules et d'étudiants rattachés
   * @param {number|string} filiereId - L'ID de la filière
   */
  async getFiliereStats(filiereId) {
    // Récupérer le nombre de modules
    const { count: modulesCount, error: modError } = await supabase
      .from('modules')
      .select('*', { count: 'exact', head: true })
      .eq('filiere_id', filiereId);

    if (modError) {
      console.error(`[FiliereModel.getFiliereStats] Erreur modules :`, modError.message);
      throw modError;
    }

    // Récupérer le nombre d'étudiants
    const { count: studentsCount, error: studError } = await supabase
      .from('etudiants')
      .select('*', { count: 'exact', head: true })
      .eq('filiere_id', filiereId);

    if (studError) {
      console.error(`[FiliereModel.getFiliereStats] Erreur étudiants :`, studError.message);
      throw studError;
    }

    return {
      filiereId,
      nombreModules: modulesCount || 0,
      nombreEtudiants: studentsCount || 0,
    };
  },
};

module.exports = FiliereModel;
