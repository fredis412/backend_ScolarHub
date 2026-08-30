const supabase = require('../config/supabase');
const pool = require('../config/db');

/**
 * Modèle de données pour les Annonces
 * Gère les interactions Supabase et PostgreSQL pour la table 'annonces'.
 */
const AnnonceModel = {
  /**
   * Récupérer toutes les annonces (avec pagination optionnelle)
   */
  async findAll(filters = {}) {
    try {
      if (supabase && typeof supabase.from === 'function') {
        try {
          let query = supabase
            .from('annonces')
            .select('*, users(id, nom, prenoms, role)');

          if (filters.filiere) {
            query = filters.includeGlobal
              ? query.or(`filiere.eq.${filters.filiere},filiere.is.null`)
              : query.eq('filiere', filters.filiere);
          }
          if (filters.niveau) query = query.eq('niveau', filters.niveau);
          if (filters.cibleRole) query = query.eq('cibleRole', filters.cibleRole);
          if (filters.statut) query = query.eq('statut', filters.statut);

          query = query.order('createdAt', { ascending: false });

          if (filters.limit) query = query.limit(filters.limit);
          if (filters.offset) query = query.offset(filters.offset);

          const { data, error } = await query;
          if (!error && data) return data;
        } catch (_) {}
      }

      // Fallback PostgreSQL pool
      let pgQuery = `
        SELECT a.id, a.titre, a.contenu, a.filiere, a.filiere_nom, a.niveau, a."cibleRole", a.categorie, a.statut, a.fichiers, a.auteur,
               COALESCE(a."createdAt", a."updatedAt", NOW()) AS "createdAt",
               JSON_BUILD_OBJECT('id', u.id, 'nom', u.nom, 'prenoms', u.prenoms, 'role', u.role) AS users
        FROM annonces a
        LEFT JOIN users u ON u.id = a.auteur
        WHERE 1=1
      `;
      const params = [];
      if (filters.filiere) {
        params.push(filters.filiere);
        pgQuery += ` AND (a.filiere = $${params.length} OR a.filiere IS NULL)`;
      }
      if (filters.niveau) {
        params.push(filters.niveau);
        pgQuery += ` AND a.niveau = $${params.length}`;
      }
      if (filters.cibleRole) {
        params.push(filters.cibleRole);
        pgQuery += ` AND a."cibleRole" = $${params.length}`;
      }
      if (filters.statut) {
        params.push(filters.statut);
        pgQuery += ` AND a.statut = $${params.length}`;
      }
      pgQuery += ` ORDER BY a."createdAt" DESC`;
      if (filters.limit) {
        params.push(filters.limit);
        pgQuery += ` LIMIT $${params.length}`;
      }
      if (filters.offset) {
        params.push(filters.offset);
        pgQuery += ` OFFSET $${params.length}`;
      }

      const { rows } = await pool.query(pgQuery, params);
      return rows;
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
      if (supabase && typeof supabase.from === 'function') {
        try {
          const { data, error } = await supabase
            .from('annonces')
            .select('*, users(id, nom, prenoms, role)')
            .eq('id', id)
            .single();

          if (!error && data) return data;
        } catch (_) {}
      }

      const { rows } = await pool.query(
        `SELECT a.id, a.titre, a.contenu, a.filiere, a.filiere_nom, a.niveau, a."cibleRole", a.categorie, a.statut, a.fichiers, a.auteur,
                COALESCE(a."createdAt", a."updatedAt", NOW()) AS "createdAt",
                JSON_BUILD_OBJECT('id', u.id, 'nom', u.nom, 'prenoms', u.prenoms, 'role', u.role) AS users
         FROM annonces a
         LEFT JOIN users u ON u.id = a.auteur
         WHERE a.id = $1`,
        [id]
      );
      return rows[0] || null;
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
      if (supabase && typeof supabase.from === 'function') {
        try {
          const { data, error } = await supabase
            .from('annonces')
            .insert([annonceData])
            .select();

          if (!error && data && data.length) return data[0];
        } catch (_) {}
      }

      const { rows } = await pool.query(
        `INSERT INTO annonces (titre, contenu, filiere, filiere_nom, niveau, "cibleRole", categorie, statut, fichiers, auteur, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING *`,
        [
          annonceData.titre,
          annonceData.contenu,
          annonceData.filiere || null,
          annonceData.filiere_nom || null,
          annonceData.niveau || null,
          annonceData.cibleRole || 'tous',
          annonceData.categorie || null,
          annonceData.statut || 'brouillon',
          JSON.stringify(annonceData.fichiers || []),
          annonceData.auteur || null,
        ]
      );
      return rows[0];
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
      if (supabase && typeof supabase.from === 'function') {
        try {
          const { data, error } = await supabase
            .from('annonces')
            .update(annonceData)
            .eq('id', id)
            .select();

          if (!error && data && data.length) return data[0];
        } catch (_) {}
      }

      const sets = [];
      const params = [id];
      if (annonceData.titre) { params.push(annonceData.titre); sets.push(`titre = $${params.length}`); }
      if (annonceData.contenu) { params.push(annonceData.contenu); sets.push(`contenu = $${params.length}`); }
      if (annonceData.filiere !== undefined) { params.push(annonceData.filiere || null); sets.push(`filiere = $${params.length}`); }
      if (annonceData.filiere_nom !== undefined) { params.push(annonceData.filiere_nom || null); sets.push(`filiere_nom = $${params.length}`); }
      if (annonceData.niveau !== undefined) { params.push(annonceData.niveau || null); sets.push(`niveau = $${params.length}`); }
      if (annonceData.cibleRole !== undefined) { params.push(annonceData.cibleRole); sets.push(`"cibleRole" = $${params.length}`); }
      if (annonceData.statut !== undefined) { params.push(annonceData.statut); sets.push(`statut = $${params.length}`); }
      sets.push(`"updatedAt" = NOW()`);

      const { rows } = await pool.query(
        `UPDATE annonces SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );
      return rows[0] || null;
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
      if (supabase && typeof supabase.from === 'function') {
        try {
          const { data, error } = await supabase
            .from('annonces')
            .delete()
            .eq('id', id)
            .select();

          if (!error && data && data.length) return data[0];
        } catch (_) {}
      }

      const { rows } = await pool.query(`DELETE FROM annonces WHERE id = $1 RETURNING *`, [id]);
      return rows[0] || null;
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
