-- ScolarHub — p35 : fiche professeur enrichie (maquette admin Professeurs)
-- À exécuter EN ENTIER dans Supabase (SQL Editor) AVANT de redémarrer le backend.

ALTER TABLE professeurs ADD COLUMN IF NOT EXISTS sexe           varchar(1);
ALTER TABLE professeurs ADD COLUMN IF NOT EXISTS lieu_naissance varchar(120);
ALTER TABLE professeurs ADD COLUMN IF NOT EXISTS grade          varchar(80);
ALTER TABLE professeurs ADD COLUMN IF NOT EXISTS expertise      varchar(200);
ALTER TABLE professeurs ADD COLUMN IF NOT EXISTS diplome        varchar(80);
ALTER TABLE professeurs ADD COLUMN IF NOT EXISTS note           text;

-- Ces colonnes existent normalement déjà sur users (utilisées pour les étudiants) ; sans effet sinon.
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_naissance date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nationalite    varchar(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url      text;
