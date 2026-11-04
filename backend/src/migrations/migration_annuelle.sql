-- ============================================================================
-- ScolarHub — Étape 3 : décision annuelle, clôture, réinscription, archives
-- Script ADDITIF et relançable. À exécuter UNE FOIS dans Supabase AVANT le code.
-- Rien n'est supprimé : les années passées restent en lecture seule.
-- ============================================================================
BEGIN;

-- 1) Décision de fin d'année (colonne `decision` déjà créée à l'étape 1) -----
ALTER TABLE inscriptions_annuelles ADD COLUMN IF NOT EXISTS decision_source TEXT;        -- 'auto' | 'manuelle'
ALTER TABLE inscriptions_annuelles ADD COLUMN IF NOT EXISTS decision_at     TIMESTAMPTZ;
ALTER TABLE inscriptions_annuelles ADD COLUMN IF NOT EXISTS decision_par    TEXT;

-- 2) Parcours de l'étudiant : actif / diplome / abandon ----------------------
ALTER TABLE etudiants ADD COLUMN IF NOT EXISTS parcours_statut TEXT NOT NULL DEFAULT 'actif';

-- 3) Frais de réinscription, fixés par l'établissement pour chaque niveau ----
CREATE TABLE IF NOT EXISTS frais_reinscription (
  etablissement_id  INTEGER NOT NULL,
  niveau            TEXT    NOT NULL,
  montant           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (montant >= 0),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (etablissement_id, niveau)
);

-- 4) Réinscription d'un étudiant pour une année ------------------------------
--    a_faire  : créée à l'ouverture de l'année (admis ou redoublant)
--    demandee : l'étudiant a fait sa demande dans l'application
--    validee  : paiement vérifié à la caisse, l'administration a validé (le niveau change ici)
--    refusee  : refus motivé, l'étudiant peut redemander
CREATE TABLE IF NOT EXISTS reinscriptions (
  id                   SERIAL PRIMARY KEY,
  etudiant_id          INTEGER NOT NULL,
  annee_academique     TEXT    NOT NULL,
  filiere_id           INTEGER,
  niveau_precedent     TEXT,
  niveau_cible         TEXT    NOT NULL,
  decision_precedente  TEXT,
  statut               TEXT    NOT NULL DEFAULT 'a_faire'
                       CHECK (statut IN ('a_faire', 'demandee', 'validee', 'refusee')),
  montant              NUMERIC(12,2),
  reference_recu       TEXT,
  motif_refus          TEXT,
  demandee_at          TIMESTAMPTZ,
  validee_at           TIMESTAMPTZ,
  validee_par          TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (etudiant_id, annee_academique)
);
CREATE INDEX IF NOT EXISTS reinscriptions_annee_statut ON reinscriptions (annee_academique, statut);

COMMIT;

-- Vérification :
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'etudiants' AND column_name = 'parcours_statut';
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('reinscriptions', 'frais_reinscription');
