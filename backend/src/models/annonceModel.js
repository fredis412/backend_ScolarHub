const supabase = require('../config/supabase');

/**
 * Modèle de données pour les Annonces
 * Gère les interactions Supabase pour la table 'annonces'.
 */
const AnnonceModel = {
  /**
   * Récupérer toutes les annonces (avec pagination optionnelle)
   */
  async findAll(filters = {}) {
    try {
      let query = supabase
        .from('annonces')
        .select('*, users(id, nom, prenoms, role)');

      // Filtrer par filière si fournie
      if (filters.filiere) {
        query = query.eq('filiere', filters.filiere);
      }

      // Filtrer par niveau si fourni
      if (filters.niveau) {
        query = query.eq('niveau', filters.niveau);
      }

      // Filtrer par rôle cible si fourni
      if (filters.cibleRole) {
        query = query.eq('cibleRole', filters.cibleRole);
      }

      // Filtrer par statut
      if (filters.statut) {
        query = query.eq('statut', filters.statut);
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
        console.error('[AnnonceModel.findAll] Erreur :', error.message);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('[AnnonceModel.findAll] Erreur :', error);
      throw error;
    }
  },

  /**
   * Récupérer une annonce par son ID
   */
  async findById(id) {
    try {
      const { data, error } = await supabase
        .from('annonces')
        .select('*, users(id, nom, prenoms, role)')
        .eq('id', id)
        .single();

      if (error) {
        console.error('[AnnonceModel.findById] Erreur :', error.message);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('[AnnonceModel.findById] Erreur :', error);
      throw error;
    }
  },

  /**
   * Créer une nouvelle annonce
   */
  async create(annonceData) {
    try {
      const { data, error } = await supabase
        .from('annonces')
        .insert([annonceData])
        .select();

      if (error) {
        console.error('[AnnonceModel.create] Erreur :', error.message);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error('[AnnonceModel.create] Erreur :', error);
      throw error;
    }
  },

  /**
   * Modifier une annonce existante
   */
  async update(id, annonceData) {
    try {
      const { data, error } = await supabase
        .from('annonces')
        .update(annonceData)
        .eq('id', id)
        .select();

      if (error) {
        console.error('[AnnonceModel.update] Erreur :', error.message);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error('[AnnonceModel.update] Erreur :', error);
      throw error;
    }
  },

  /**
   * Supprimer une annonce
   */
  async delete(id) {
    try {
      const { data, error } = await supabase
        .from('annonces')
        .delete()
        .eq('id', id)
        .select();

      if (error) {
        console.error('[AnnonceModel.delete] Erreur :', error.message);
        throw error;
      }

      return data[0];
    } catch (error) {
      console.error('[AnnonceModel.delete] Erreur :', error);
      throw error;
    }
  },

  /**
   * Ajouter un fichier à une annonce
   */
  async addFile(id, fileUrl) {
    try {
      // Récupérer l'annonce actuelle
      const annonce = await this.findById(id);
      if (!annonce) throw new Error('Annonce non trouvée');

      // Ajouter le fichier au tableau
      const fichiers = annonce.fichiers || [];
      fichiers.push(fileUrl);

      // Mettre à jour l'annonce
      return await this.update(id, { fichiers });
    } catch (error) {
      console.error('[AnnonceModel.addFile] Erreur :', error);
      throw error;
    }
  },

  /**
   * Supprimer un fichier d'une annonce
   */
  async removeFile(id, fileUrl) {
    try {
      const annonce = await this.findById(id);
      if (!annonce) throw new Error('Annonce non trouvée');

      const fichiers = (annonce.fichiers || []).filter((f) => f !== fileUrl);

      return await this.update(id, { fichiers });
    } catch (error) {
      console.error('[AnnonceModel.removeFile] Erreur :', error);
      throw error;
    }
  },

  /**
   * Publier une annonce (changement de statut)
   */
  async publish(id) {
    try {
      return await this.update(id, {
        statut: 'publie',
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[AnnonceModel.publish] Erreur :', error);
      throw error;
    }
  },
};

module.exports = AnnonceModel;
