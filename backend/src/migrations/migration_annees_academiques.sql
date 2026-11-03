-- ============================================================================
-- ScolarHub — Étape 1 : années académiques + inscriptions annuelles
-- Script ADDITIF et relançable (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- À exécuter UNE FOIS dans Supabase (SQL Editor) AVANT de déployer le code.
-- ============================================================================
BEGIN;

-- 1) Les années académiques d'un établissement -------------------------------
CREATE TABLE IF NOT EXISTS annees_academiques (
  id                      SERIAL PRIMARY KEY,
  etablissement_id        INTEGER NOT NULL,
  libelle                 TEXT    NOT NULL,                 -- ex. '2025-2026'
  statut                  TEXT    NOT NULL DEFAULT 'en_cours'
                          CHECK (statut IN ('en_cours', 'cloturee')),
  date_rattrapage_debut   DATE,
  date_rattrapage_fin     DATE,
  regle_rattrapage        TEXT    NOT NULL DEFAULT 'remplace'
                          CHECK (regle_rattrapage IN ('remplace', 'meilleure')),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (etablissement_id, libelle)
);
-- Une seule année « en cours » par établissement
CREATE UNIQUE INDEX IF NOT EXISTS annees_une_en_cours
  ON annees_academiques (etablissement_id) WHERE statut = 'en_cours';

-- 2) L'inscription d'un étudiant pour UNE année ------------------------------
--    (sa classe cette année-là : elle ne change plus une fois l'année passée)
CREATE TABLE IF NOT EXISTS inscriptions_annuelles (
  id                SERIAL PRIMARY KEY,
  etudiant_id       INTEGER NOT NULL,
  annee_academique  TEXT    NOT NULL,
  filiere_id        INTEGER,
  niveau            TEXT,
  decision          TEXT,      -- NULL / 'admis' / 'redoublant' / 'diplome' / 'abandon' (étape 3)
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (etudiant_id, annee_academique)
);
CREATE INDEX IF NOT EXISTS inscriptions_annuelles_classe
  ON inscriptions_annuelles (annee_academique, filiere_id, niveau);

-- 3) Années déjà utilisées dans les notes / bulletins : on les reprend --------
INSERT INTO annees_academiques (etablissement_id, libelle, statut)
SELECT DISTINCT f.etablissement_id, x.annee, 'cloturee'
FROM (
  SELECT filiere_id, annee_academique AS annee FROM sessions_notes
  UNION
  SELECT filiere_id, annee_academique AS annee FROM bulletins
) x
JOIN filieres f ON f.id = x.filiere_id
WHERE COALESCE(x.annee, '') <> '' AND f.etablissement_id IS NOT NULL
ON CONFLICT (etablissement_id, libelle) DO NOTHING;

-- La plus récente de chaque établissement devient « en cours »
UPDATE annees_academiques a
   SET statut = 'en_cours'
 WHERE a.libelle = (SELECT MAX(b.libelle) FROM annees_academiques b
                     WHERE b.etablissement_id = a.etablissement_id)
   AND NOT EXISTS (SELECT 1 FROM annees_academiques c
                    WHERE c.etablissement_id = a.etablissement_id AND c.statut = 'en_cours');

-- Établissement sans aucune année : on en crée une d'après la date du jour
INSERT INTO annees_academiques (etablissement_id, libelle, statut)
SELECT e.id,
       CASE WHEN EXTRACT(MONTH FROM NOW()) >= 9
            THEN EXTRACT(YEAR FROM NOW())::int || '-' || (EXTRACT(YEAR FROM NOW())::int + 1)
            ELSE (EXTRACT(YEAR FROM NOW())::int - 1) || '-' || EXTRACT(YEAR FROM NOW())::int END,
       'en_cours'
FROM etablissements e
WHERE NOT EXISTS (SELECT 1 FROM annees_academiques a WHERE a.etablissement_id = e.id);

-- 4) Historique : la classe de chaque étudiant d'après ses bulletins ---------
INSERT INTO inscriptions_annuelles (etudiant_id, annee_academique, filiere_id, niveau)
SELECT DISTINCT ON (b.etudiant_id, b.annee_academique)
       b.etudiant_id, b.annee_academique, b.filiere_id, b.niveau
FROM bulletins b
WHERE COALESCE(b.annee_academique, '') <> ''
ORDER BY b.etudiant_id, b.annee_academique, b.id
ON CONFLICT (etudiant_id, annee_academique) DO NOTHING;

-- 5) Année en cours : tous les étudiants actuels ------------------------------
INSERT INTO inscriptions_annuelles (etudiant_id, annee_academique, filiere_id, niveau)
SELECT e.id, a.libelle, e.filiere_id, e.niveau
FROM etudiants e
JOIN annees_academiques a ON a.etablissement_id = e.etablissement_id AND a.statut = 'en_cours'
WHERE e.filiere_id IS NOT NULL AND e.niveau IS NOT NULL
ON CONFLICT (etudiant_id, annee_academique) DO NOTHING;

-- 6) Synchronisation automatique -------------------------------------------
--    Chaque inscription ou changement de classe d'un étudiant met à jour sa
--    ligne de l'année en cours. Aucune modification du code d'inscription.
CREATE OR REPLACE FUNCTION sync_inscription_annuelle() RETURNS trigger AS $$
DECLARE v_annee TEXT;
BEGIN
  IF NEW.filiere_id IS NULL OR NEW.niveau IS NULL OR NEW.etablissement_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT libelle INTO v_annee FROM annees_academiques
   WHERE etablissement_id = NEW.etablissement_id AND statut = 'en_cours';
  IF v_annee IS NULL THEN RETURN NEW; END IF;
  INSERT INTO inscriptions_annuelles (etudiant_id, annee_academique, filiere_id, niveau)
  VALUES (NEW.id, v_annee, NEW.filiere_id, NEW.niveau)
  ON CONFLICT (etudiant_id, annee_academique)
  DO UPDATE SET filiere_id = EXCLUDED.filiere_id, niveau = EXCLUDED.niveau;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_inscription_annuelle ON etudiants;
CREATE TRIGGER trg_sync_inscription_annuelle
AFTER INSERT OR UPDATE OF filiere_id, niveau ON etudiants
FOR EACH ROW EXECUTE FUNCTION sync_inscription_annuelle();

COMMIT;

-- Vérification (à lancer après) :
-- SELECT * FROM annees_academiques ORDER BY etablissement_id, libelle;
-- SELECT annee_academique, COUNT(*) FROM inscriptions_annuelles GROUP BY 1 ORDER BY 1;
