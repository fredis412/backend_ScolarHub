const supabase = require('../config/supabase');

/**
 * Modèle de données pour les Emplois Du Temps (EDT)
 * Gère les interactions Supabase pour la table 'edt'.
 */
const EdtModel = {
  /**
   * Récupérer tous les EDT
   */
  async findAll(filters = {}) {
    try {
      let query = supabase.from('edt').select('*');

      // Filtrer par filière
      if (filters.filiere) {
        query = query.eq('filiere', filters.filiere);
      }

      // Filtrer par niveau
      if (filters.niveau) {
        query = query.eq('niveau', filters.niveau);
      }

      // Filtrer par année académique
      if (filters.anneeAcademique) {
        query = query.eq('anneeAcademique', filters.anneeAcademique);
      }

      // Exclure les archives par défaut (sauf si explicitement demandé)
      if (!filters.includeArchives) {
        query = query.eq('archive', false);
      }

      // Ordonner par date de création (plus récentes d'abord)
      query = query.order('createdAt', { ascending: false });

      // Pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[EdtModel.findAll] Erreur :', error.message);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('[EdtModel.findAll] Erreur :', error);
      throw error;
    }
  },

  /**
   * Récupérer un EDT par son ID
   */
  async findById(id) {
    try {
      const { data, error } = await supabase
        .from('edt')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('[EdtModel.findById] Erreur :', error.message);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('[EdtModel.findById] Erreur :', error);
      throw error;
    }
  },

  /**
   * Récupérer l'EDT par filière et niveau
   */
  async findByFilierAndNiveau(filiere, niveau) {
    try {
      const { data, error } = await supabase
        .from('edt')
        .select('*')
        .eq('filiere', filiere)
        .eq('niveau', niveau)
        .eq('archive', false)
        .order('createdAt', { ascending: false })
        .limit(1);

      if (error) {
        console.error('[EdtModel.findByFilierAndNiveau] Erreur :', error.message);
        throw error;
      }

      return data ? data[0] : null;
    } catch (error) {
      console.error('[EdtModel.findByFilierAndNiveau] Erreur :', error);
      throw error;
    }
  },

  /**
   * Créer un nouvel EDT
   */
  async create(edtData) {
    try {
      const { data, error } = await supabase
        .from('edt')
        .insert([edtData])
        .select();

      if (error) {
        console.error('[EdtModel.create] Erreur :', error.message);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error('[EdtModel.create] Erreur :', error);
      throw error;
    }
  },

  /**
   * Modifier un EDT existant
   */
  async update(id, edtData) {
    try {
      const { data, error } = await supabase
        .from('edt')
        .update(edtData)
        .eq('id', id)
        .select();

      if (error) {
        console.error('[EdtModel.update] Erreur :', error.message);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error('[EdtModel.update] Erreur :', error);
      throw error;
    }
  },

  /**
   * Archiver un EDT (suppression logique)
   */
  async archive(id) {
    try {
      return await this.update(id, {
        archive: true,
        archivedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[EdtModel.archive] Erreur :', error);
      throw error;
    }
  },

  /**
   * Supprimer un EDT (suppression physique)
   */
  async delete(id) {
    try {
      const { data, error } = await supabase
        .from('edt')
        .delete()
        .eq('id', id)
        .select();

      if (error) {
        console.error('[EdtModel.delete] Erreur :', error.message);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error('[EdtModel.delete] Erreur :', error);
      throw error;
    }
  },
};

module.exports = EdtModel;
