-- Identité complémentaire des étudiants (carte d'étudiant recto/verso)
ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS sexe           varchar(1);
ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS lieu_naissance text;
ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS urgence_nom    text;
ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS urgence_tel    text;
ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS urgence_lien   text;
-- date_naissance et nationalite existent déjà (users/etudiants)

-- Pièces jointes de l'inscription (CNIB / acte de naissance, autres documents)
CREATE TABLE IF NOT EXISTS etudiant_documents (
  id          serial PRIMARY KEY,
  etudiant_id integer NOT NULL REFERENCES etudiants(id) ON DELETE CASCADE,
  type        varchar(20) NOT NULL DEFAULT 'autre',
  nom_fichier text,
  url         text NOT NULL,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etudiant_documents_etu ON etudiant_documents(etudiant_id);

-- Régime : cours du jour / cours du soir (les étudiants existants passent en « jour »)
ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS regime varchar(10) NOT NULL DEFAULT 'jour';
