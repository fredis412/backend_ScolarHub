-- ════════════════════════════════════════════════════════════════════════════
-- Réclamations : circuit Étudiant → Admin → Professeur → Admin → Étudiant
-- À exécuter UNE FOIS dans Supabase (SQL Editor) AVANT de redémarrer le backend.
-- Les anciennes réclamations restent valables (étape déduite de leur statut).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS numero            varchar(20);
ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS categorie         varchar(60);
ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS objet             varchar(160);
-- etape : admin | professeur | verification | termine
ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS etape             varchar(20) DEFAULT 'admin';
ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS prof_id           uuid;
ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS prof_commentaire  text;
ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS date_transmission timestamptz;
ALTER TABLE reclamations ADD COLUMN IF NOT EXISTS date_retour       timestamptz;

-- Les nouvelles catégories ne sont plus limitées à note/moyenne/absence
ALTER TABLE reclamations DROP CONSTRAINT IF EXISTS reclamations_type_check;
ALTER TABLE reclamations DROP CONSTRAINT IF EXISTS reclamations_statut_check;

-- Rattrapage des anciennes lignes
UPDATE reclamations SET categorie = 'Notes & Moyennes' WHERE categorie IS NULL AND type IN ('note','moyenne','absence');
UPDATE reclamations SET etape = CASE
    WHEN statut IN ('resolu','rejete') THEN 'termine'
    WHEN statut = 'en_cours'           THEN 'professeur'
    ELSE 'admin' END
 WHERE etape IS NULL OR etape = 'admin';

-- Échanges (fil de discussion). interne = visible seulement admin/professeur
CREATE TABLE IF NOT EXISTS reclamation_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reclamation_id  uuid NOT NULL REFERENCES reclamations(id) ON DELETE CASCADE,
    auteur_id       uuid,
    auteur_role     varchar(20) NOT NULL,
    contenu         text NOT NULL,
    interne         boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recl_msg_recl ON reclamation_messages(reclamation_id, created_at);

-- Pièces jointes
CREATE TABLE IF NOT EXISTS reclamation_pieces (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reclamation_id  uuid NOT NULL REFERENCES reclamations(id) ON DELETE CASCADE,
    nom             varchar(255),
    url             text NOT NULL,
    mime            varchar(100),
    taille          integer,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recl_pieces_recl ON reclamation_pieces(reclamation_id);

CREATE INDEX IF NOT EXISTS idx_recl_prof ON reclamations(prof_id);
