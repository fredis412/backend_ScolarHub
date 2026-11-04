-- ============================================================================
-- ScolarHub — Étape 2 : session de rattrapage
-- Script ADDITIF et relançable. À exécuter UNE FOIS dans Supabase AVANT le code.
-- Le rattrapage vit dans ses propres tables : les notes normales, les moyennes
-- provisoires et les écrans actuels ne sont donc jamais touchés.
-- ============================================================================
BEGIN;

-- 1) Une session de rattrapage = un module d'une classe, pour une année
CREATE TABLE IF NOT EXISTS sessions_rattrapage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filiere_id        INTEGER NOT NULL,
  niveau            TEXT    NOT NULL,
  module_id         INTEGER NOT NULL,
  semestre          TEXT    NOT NULL,
  annee_academique  TEXT    NOT NULL,
  professeur_id     TEXT    NOT NULL,                 -- users.id du professeur (texte : indépendant du type)
  statut            TEXT    NOT NULL DEFAULT 'en_attente'
                    CHECK (statut IN ('en_attente', 'validee', 'rejetee')),
  is_sent           BOOLEAN NOT NULL DEFAULT FALSE,   -- transmise à l'administration
  motif_rejet       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  validated_at      TIMESTAMPTZ,
  UNIQUE (module_id, filiere_id, niveau, annee_academique)
);
CREATE INDEX IF NOT EXISTS sessions_rattrapage_classe
  ON sessions_rattrapage (filiere_id, niveau, annee_academique);

-- 2) Une note de rattrapage par étudiant et par session
CREATE TABLE IF NOT EXISTS notes_rattrapage (
  id           SERIAL PRIMARY KEY,
  session_id   UUID    NOT NULL REFERENCES sessions_rattrapage(id) ON DELETE CASCADE,
  etudiant_id  INTEGER NOT NULL,
  valeur       NUMERIC(5,2) NOT NULL CHECK (valeur >= 0 AND valeur <= 20),
  UNIQUE (session_id, etudiant_id)
);

-- 3) Bulletins : « normal » ou « après rattrapage », côte à côte -------------
ALTER TABLE bulletins ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'normale';

-- L'ancienne clé unique (étudiant, semestre, année) devient
-- (étudiant, semestre, année, type). On retrouve l'ancienne sans connaître son nom.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT i.indexrelid::regclass::text AS idx, con.conname
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
    WHERE t.relname = 'bulletins' AND i.indisunique AND NOT i.indisprimary
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
             FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k)
          = ARRAY['annee_academique', 'etudiant_id', 'semestre']
  LOOP
    IF r.conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE bulletins DROP CONSTRAINT %I', r.conname);
    ELSE
      EXECUTE format('DROP INDEX %s', r.idx);
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bulletins_unique_type
  ON bulletins (etudiant_id, semestre, annee_academique, session_type);

COMMIT;

-- Vérification :
-- SELECT indexname FROM pg_indexes WHERE tablename = 'bulletins';
-- (doit contenir bulletins_unique_type, et plus l'ancienne clé à 3 colonnes)
