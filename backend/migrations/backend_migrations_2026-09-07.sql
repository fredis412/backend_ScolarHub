-- =============================================================================
-- Migration : 2026-09-07 — Corrections colonnes SQL + gestion multi-filières
-- des professeurs (domaines, filières, niveaux multiples)
-- =============================================================================
-- Ces commandes ont été exécutées manuellement dans l'éditeur SQL de Supabase.
-- Ce fichier les documente pour qu'elles puissent être rejouées si la base
-- doit être reconstruite (nouvel environnement, nouvelle instance Supabase...).
-- Toutes les commandes sont idempotentes (IF NOT EXISTS / IF EXISTS) sauf
-- indication contraire.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table de liaison professeur ↔ filière ↔ niveau
--    Permet à un professeur d'enseigner dans plusieurs filières, et pour
--    chaque filière, à plusieurs niveaux (Licence 1, 2, 3, Master 1, 2...).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS professeur_filieres (
  id SERIAL PRIMARY KEY,
  professeur_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filiere_id INTEGER NOT NULL REFERENCES filieres(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professeur_filieres_prof ON professeur_filieres(professeur_id);
CREATE INDEX IF NOT EXISTS idx_professeur_filieres_filiere ON professeur_filieres(filiere_id);

-- La colonne niveau a été ajoutée après coup (la table existait déjà sans elle
-- suite à une tentative précédente) :
ALTER TABLE professeur_filieres ADD COLUMN IF NOT EXISTS niveau TEXT NOT NULL DEFAULT 'Non défini';
ALTER TABLE professeur_filieres ALTER COLUMN niveau DROP DEFAULT;

-- Contrainte unique correcte : un même (prof, filière, niveau) ne peut
-- apparaître qu'une fois, mais un prof PEUT avoir plusieurs niveaux pour une
-- même filière (Licence 1 ET Licence 2 sur la même filière, par exemple).
-- Remplace l'ancienne contrainte (professeur_id, filiere_id) seule, qui
-- empêchait justement d'avoir plusieurs niveaux par filière.
ALTER TABLE professeur_filieres DROP CONSTRAINT IF EXISTS professeur_filieres_professeur_id_filiere_id_key;
ALTER TABLE professeur_filieres DROP CONSTRAINT IF EXISTS professeur_filieres_unique;
ALTER TABLE professeur_filieres ADD CONSTRAINT professeur_filieres_unique
  UNIQUE (professeur_id, filiere_id, niveau);

-- -----------------------------------------------------------------------------
-- 2. Rafraîchir le cache de schéma PostgREST/Supabase (nécessaire après
--    création/modification de table pour que l'API RPC execute_sql la
--    reconnaisse immédiatement).
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 3. Mention PAR NOTE (par étudiant), pas par session.
--    Le design initial mettait la mention sur sessions_notes (une seule
--    valeur pour toute la classe/module). Corrigé : chaque note individuelle
--    a sa propre mention, car tous les étudiants d'une même session n'ont
--    pas la même performance.
-- -----------------------------------------------------------------------------
ALTER TABLE notes ADD COLUMN IF NOT EXISTS mention TEXT;
-- La colonne sessions_notes.mention est conservée (pas supprimée) pour ne
-- pas casser les sessions déjà créées, mais n'est plus utilisée pour les
-- nouvelles sessions à partir de cette migration.

-- =============================================================================
-- Notes — bugs de colonnes corrigés dans le CODE ce soir (backend), sans
-- impact sur le schéma de la base (colonnes déjà correctes, c'était le code
-- qui référençait de mauvais noms) :
--   - auth.controller.js : p.telephone → p.tel (table `parents`)
--   - auth.controller.js : p.matricule_enfant → p.matricule (table `parents`)
--   - auth.controller.js : suppression de la jointure sur p.etudiant_id
--     (colonne inexistante sur `parents`, sans équivalent)
--   - etudiants.controller.js : LEFT JOIN filieres f ON f.id =
--     COALESCE(e.filiere_id, u.filiere_id) → f.id = e.filiere_id
--     (u.filiere_id n'existe pas sur `users`, seule `etudiants.filiere_id`
--     existe)
-- Ces corrections ne nécessitent aucune action SQL, seulement le déploiement
-- du code backend corrigé.
-- =============================================================================
