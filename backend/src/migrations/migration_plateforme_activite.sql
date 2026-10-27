-- ScolarHub — Journal d'activité de l'espace Plateforme (p46)
-- À exécuter UNE FOIS dans Supabase (SQL Editor). Sans effet si la table existe déjà.
CREATE TABLE IF NOT EXISTS plateforme_activite (
  id                 serial PRIMARY KEY,
  type               varchar(30) NOT NULL,        -- creation | modification | suspension | reactivation | super_admin | connexion | echec_cle
  etablissement_id   integer,
  etablissement_sigle varchar(40),
  etablissement_nom  text,
  detail             text,
  ip                 varchar(60),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plateforme_activite_date ON plateforme_activite (created_at DESC);
