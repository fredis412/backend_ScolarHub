const supabase = require('../config/supabase');

/**
 * Modèle de données pour les Notes (Évaluations)
 * Gère les interactions Supabase pour la table 'notes'.
 */
const GradeModel = {

  /**
   * Récupérer une note par son ID
   * @param {number|string} id - L'ID de la note
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('notes')
      .select('*, etudiants(id, matricule, nom, prenoms), modules(id, nom, coefficient)')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(`[GradeModel.findById] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Récupérer toutes les notes enregistrées
   */
  async findAll() {
    const { data, error } = await supabase
      .from('notes')
      .select('*, etudiants(id, nom, prenoms), modules(id, nom)')
      .order('id', { ascending: false });
    
    if (error) {
      console.error(`[GradeModel.findAll] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Enregistrer une nouvelle note
   * @param {Object} gradeData - Données de la note (etudiant_id, module_id, valeur)
   */
  async create(gradeData) {
    const { data, error } = await supabase
      .from('notes')
      .insert([gradeData])
      .select();
    
    if (error) {
      console.error(`[GradeModel.create] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Modifier une note existante
   * @param {number|string} id - L'ID de la note à modifier
   * @param {Object} gradeData - Nouvelles valeurs
   */
  async update(id, gradeData) {
    const { data, error } = await supabase
      .from('notes')
      .update(gradeData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[GradeModel.update] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Supprimer une note
   * @param {number|string} id - L'ID de la note à supprimer
   */
  async delete(id) {
    const { data, error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[GradeModel.delete] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Requête spécifique : Récupérer toutes les notes d'un étudiant (avec détails des cours)
   * @param {number|string} studentId - L'ID de l'étudiant
   */
  async findGradesByStudentId(studentId) {
    const { data, error } = await supabase
      .from('notes')
      .select('*, modules(id, nom, coefficient, volume_horaire)')
      .eq('etudiant_id', studentId);
    
    if (error) {
      console.error(`[GradeModel.findGradesByStudentId] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Requête spécifique : Récupérer toutes les notes des étudiants pour un module donné
   * @param {number|string} moduleId - L'ID du module
   */
  async findGradesByModuleId(moduleId) {
    const { data, error } = await supabase
      .from('notes')
      .select('*, etudiants(id, matricule, nom, prenoms)')
      .eq('module_id', moduleId);
    
    if (error) {
      console.error(`[GradeModel.findGradesByModuleId] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Requête spécifique & Métier : Calculer la moyenne générale pondérée d'un étudiant
   * @param {number|string} studentId - L'ID de l'étudiant
   */
  async calculateStudentAverage(studentId) {
    const grades = await this.findGradesByStudentId(studentId);
    
    if (!grades || grades.length === 0) return 0.0;

    let weightedSum = 0;
    let coefficientSum = 0;

    for (const record of grades) {
      const coeff = record.modules ? Number(record.modules.coefficient || 1) : 1;
      const note = Number(record.valeur || 0);

      weightedSum += note * coeff;
      coefficientSum += coeff;
    }

    return coefficientSum === 0 ? 0.0 : Number((weightedSum / coefficientSum).toFixed(2));
  },
};

module.exports = GradeModel;
