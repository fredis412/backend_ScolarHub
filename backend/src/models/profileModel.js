const supabase = require('../config/supabase');

/**
 * Modèle de données pour les Profils et Utilisateurs (Étudiants, Professeurs, Membres Admin)
 * Gère les interactions Supabase pour toutes les entités de type profil utilisateur.
 */
const ProfileModel = {
  
  // =========================================================================
  // ─── SECTION ÉTUDIANTS ───────────────────────────────────────────────────
  // =========================================================================

  /**
   * Récupérer un étudiant par son ID (avec sa filière associée)
   * @param {number|string} id - L'ID de l'étudiant
   */
  async findStudentById(id) {
    const { data, error } = await supabase
      .from('etudiants')
      .select('*, filieres(id, nom, description)')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(`[ProfileModel.findStudentById] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Récupérer tous les étudiants enregistrés
   */
  async findAllStudents() {
    const { data, error } = await supabase
      .from('etudiants')
      .select('*, filieres(id, nom)');
    
    if (error) {
      console.error(`[ProfileModel.findAllStudents] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Créer un nouvel étudiant
   * @param {Object} studentData - Données de l'étudiant
   */
  async createStudent(studentData) {
    const { data, error } = await supabase
      .from('etudiants')
      .insert([studentData])
      .select();
    
    if (error) {
      console.error(`[ProfileModel.createStudent] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Mettre à jour les informations d'un étudiant
   * @param {number|string} id - L'ID de l'étudiant à modifier
   * @param {Object} studentData - Nouvelles données de l'étudiant
   */
  async updateStudent(id, studentData) {
    const { data, error } = await supabase
      .from('etudiants')
      .update(studentData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[ProfileModel.updateStudent] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Supprimer un étudiant
   * @param {number|string} id - L'ID de l'étudiant à supprimer
   */
  async deleteStudent(id) {
    const { data, error } = await supabase
      .from('etudiants')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[ProfileModel.deleteStudent] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Requête spécifique : Récupérer tous les étudiants d'une filière donnée
   * @param {number|string} filiereId - L'ID de la filière
   */
  async findStudentsByFiliere(filiereId) {
    const { data, error } = await supabase
      .from('etudiants')
      .select('*')
      .eq('filiere_id', filiereId);
    
    if (error) {
      console.error(`[ProfileModel.findStudentsByFiliere] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  // =========================================================================
  // ─── SECTION PROFESSEURS ─────────────────────────────────────────────────
  // =========================================================================

  /**
   * Récupérer un professeur par son ID
   * @param {number|string} id - L'ID du professeur
   */
  async findProfessorById(id) {
    const { data, error } = await supabase
      .from('professeurs')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(`[ProfileModel.findProfessorById] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Récupérer tous les professeurs
   */
  async findAllProfessors() {
    const { data, error } = await supabase
      .from('professeurs')
      .select('*');
    
    if (error) {
      console.error(`[ProfileModel.findAllProfessors] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Créer un nouveau professeur
   * @param {Object} profData - Données du professeur
   */
  async createProfessor(profData) {
    const { data, error } = await supabase
      .from('professeurs')
      .insert([profData])
      .select();
    
    if (error) {
      console.error(`[ProfileModel.createProfessor] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Modifier les données d'un professeur
   * @param {number|string} id - L'ID du professeur
   * @param {Object} profData - Données de modification
   */
  async updateProfessor(id, profData) {
    const { data, error } = await supabase
      .from('professeurs')
      .update(profData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[ProfileModel.updateProfessor] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Supprimer un professeur
   * @param {number|string} id - L'ID du professeur à supprimer
   */
  async deleteProfessor(id) {
    const { data, error } = await supabase
      .from('professeurs')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[ProfileModel.deleteProfessor] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  // =========================================================================
  // ─── SECTION MEMBRES (ADMINISTRATION / DIRECTION / SCOLARITÉ) ────────────
  // =========================================================================

  /**
   * Récupérer un membre administratif par son ID
   * @param {number|string} id - L'ID du membre
   */
  async findMemberById(id) {
    const { data, error } = await supabase
      .from('membres')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error(`[ProfileModel.findMemberById] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Récupérer tous les membres administratifs
   */
  async findAllMembers() {
    const { data, error } = await supabase
      .from('membres')
      .select('*');
    
    if (error) {
      console.error(`[ProfileModel.findAllMembers] Erreur :`, error.message);
      throw error;
    }
    return data;
  },

  /**
   * Créer un nouveau membre administratif
   * @param {Object} memberData - Données du membre
   */
  async createMember(memberData) {
    const { data, error } = await supabase
      .from('membres')
      .insert([memberData])
      .select();
    
    if (error) {
      console.error(`[ProfileModel.createMember] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Mettre à jour un membre administratif
   * @param {number|string} id - L'ID du membre
   * @param {Object} memberData - Données de mise à jour
   */
  async updateMember(id, memberData) {
    const { data, error } = await supabase
      .from('membres')
      .update(memberData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[ProfileModel.updateMember] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },

  /**
   * Supprimer un membre administratif
   * @param {number|string} id - L'ID du membre
   */
  async deleteMember(id) {
    const { data, error } = await supabase
      .from('membres')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error(`[ProfileModel.deleteMember] Erreur :`, error.message);
      throw error;
    }
    return data[0];
  },
};

module.exports = ProfileModel;
