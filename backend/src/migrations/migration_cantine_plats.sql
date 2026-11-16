-- Cantine : un plat = une ligne (photo, description, catégorie, prix, disponibilité).
-- À exécuter une fois dans l'éditeur SQL de Supabase. Sans danger si relancé.

CREATE TABLE IF NOT EXISTS cantine_plats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date    NOT NULL,
  repas        text    NOT NULL CHECK (repas IN ('petit_dejeuner', 'dejeuner', 'diner')),
  nom          text    NOT NULL,
  description  text    NOT NULL DEFAULT '',
  categorie    text    NOT NULL DEFAULT 'plat_principal',
  prix         integer NOT NULL DEFAULT 0 CHECK (prix >= 0),
  image_url    text,
  disponible   boolean NOT NULL DEFAULT true,
  ordre        integer NOT NULL DEFAULT 0,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Même type que cantine_menus.etablissement_id (uuid par défaut si introuvable).
DO $$
DECLARE t text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO t
  FROM pg_attribute a
  WHERE a.attrelid = 'cantine_menus'::regclass AND a.attname = 'etablissement_id' AND NOT a.attisdropped;
  IF t IS NULL THEN t := 'uuid'; END IF;
  EXECUTE format('ALTER TABLE cantine_plats ADD COLUMN IF NOT EXISTS etablissement_id %s', t);
END $$;

CREATE INDEX IF NOT EXISTS cantine_plats_etab_date_repas_idx
  ON cantine_plats (etablissement_id, date, repas);

-- Horaires d'ouverture et lieu de la cantine (un réglage par établissement).
CREATE TABLE IF NOT EXISTS cantine_parametres (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ouverture  text NOT NULL DEFAULT '07:00',
  fermeture  text NOT NULL DEFAULT '19:00',
  lieu       text NOT NULL DEFAULT 'Restaurant universitaire',
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO t
  FROM pg_attribute a
  WHERE a.attrelid = 'cantine_menus'::regclass AND a.attname = 'etablissement_id' AND NOT a.attisdropped;
  IF t IS NULL THEN t := 'uuid'; END IF;
  EXECUTE format('ALTER TABLE cantine_parametres ADD COLUMN IF NOT EXISTS etablissement_id %s', t);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cantine_parametres_etab_uniq ON cantine_parametres (etablissement_id);

-- Commandes de la cantine : un ticket par commande, plusieurs lignes (plats).
CREATE TABLE IF NOT EXISTS cantine_commandes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero         integer NOT NULL,                 -- numéro du jour (1, 2, 3...)
  ticket         text    NOT NULL,                 -- « T-007 »
  date_commande  date    NOT NULL DEFAULT current_date,
  user_id        text    NOT NULL,
  matricule      text,
  nom            text,
  prenoms        text,
  filiere_nom    text,
  niveau         text,
  total          integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  statut         text    NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'traitee', 'annulee')),
  traitee_at     timestamptz,
  traitee_par    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cantine_commande_lignes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id  uuid NOT NULL REFERENCES cantine_commandes(id) ON DELETE CASCADE,
  repas        text NOT NULL,
  plat_nom     text NOT NULL,
  prix         integer NOT NULL DEFAULT 0,
  quantite     integer NOT NULL DEFAULT 1 CHECK (quantite > 0)
);

DO $$
DECLARE t text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO t
  FROM pg_attribute a
  WHERE a.attrelid = 'cantine_menus'::regclass AND a.attname = 'etablissement_id' AND NOT a.attisdropped;
  IF t IS NULL THEN t := 'uuid'; END IF;
  EXECUTE format('ALTER TABLE cantine_commandes ADD COLUMN IF NOT EXISTS etablissement_id %s', t);
END $$;

CREATE INDEX IF NOT EXISTS cantine_commandes_statut_idx ON cantine_commandes (etablissement_id, statut, created_at DESC);
CREATE INDEX IF NOT EXISTS cantine_commandes_user_idx   ON cantine_commandes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cantine_lignes_commande_idx  ON cantine_commande_lignes (commande_id);

