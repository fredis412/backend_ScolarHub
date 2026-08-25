const supabase = require('../config/supabase');

/**
 * Modèle de données pour les Modules / Cours
 * Gère les interactions Supabase pour la table 'modules' et la table de liaison 'module_professeur'.
 */
const CourseModel = {

  /**
   * Récupérer un module par son ID (avec sa filière associée)
   * @param {number|string} id - L'ID de l'enregistrement
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('modules')
      .select('*, filieres(id, nom)')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(`[CourseModel.findById] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Récupérer tous les modules avec leurs filières associées
   */
  async findAll() {
    const { data, error } = await supabase
      .from('modules')
      .select('*, filieres(id, nom)')
      .order('nom', { ascending: true });
    
    if (error) {
      console.error(`[CourseModel.findAll] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Créer un nouveau module
   * @param {Object} courseData - Données du module
   */
  async create(courseData) {
    const { data, error } = await supabase
      .from('modules')
      .insert([courseData])
      .select();
    
    if (error) {
      console.error(`[CourseModel.create] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Mettre à jour un module
   * @param {number|string} id - L'ID du module à modifier
   * @param {Object} courseData - Nouvelles données du module
   */
  async update(id, courseData) {
    const { data, error } = await supabase
      .from('modules')
      .update(courseData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[CourseModel.update] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Supprimer un module
   * @param {number|string} id - L'ID du module à supprimer
   */
  async delete(id) {
    const { data, error } = await supabase
      .from('modules')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[CourseModel.delete] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Requête spécifique : Récupérer tous les modules d'une filière donnée
   * @param {number|string} filiereId - L'ID de la filière
   */
  async findModulesByFiliere(filiereId) {
    const { data, error } = await supabase
      .from('modules')
      .select('*')
      .eq('filiere_id', filiereId);
    
    if (error) {
      console.error(`[CourseModel.findModulesByFiliere] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Requête spécifique : Associer un professeur à un module (Table de liaison module_professeur)
   * @param {number} moduleId - L'ID du module
   * @param {number} professeurId - L'ID du professeur
   */
  async assignProfessorToModule(moduleId, professeurId) {
    const { data, error } = await supabase
      .from('module_professeur')
      .insert([{ module_id: moduleId, professeur_id: professeurId }])
      .select();

    if (error) {
      console.error(`[CourseModel.assignProfessorToModule] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Requête spécifique : Obtenir tous les professeurs en charge d'un module
   * @param {number} moduleId - L'ID du module
   */
  async findProfessorsByModule(moduleId) {
    const { data, error } = await supabase
      .from('module_professeur')
      .select('professeur:professeurs(*)')
      .eq('module_id', moduleId);

    if (error) {
      console.error(`[CourseModel.findProfessorsByModule] Erreur :`, error.message);
      throw error;
    }
    
    // Simplifier le tableau d'objets imbriqués
    return data.map(item => item.professeur);
  },
};

module.exports = CourseModel;
