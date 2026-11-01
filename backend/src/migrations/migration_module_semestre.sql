-- Le semestre devient une propriété du module (défini par l'administration).
ALTER TABLE modules ADD COLUMN IF NOT EXISTS semestre integer;

-- Modules existants : on reprend le semestre déjà utilisé, SEULEMENT s'il est sans ambiguïté
-- (toutes les affectations professeur de ce module portent le même semestre).
UPDATE modules m
SET semestre = x.s
FROM (
  SELECT module_id,
         MIN(NULLIF(regexp_replace(semestre::text, '\D', '', 'g'), '')::int) AS s
  FROM professeur_modules
  GROUP BY module_id
  HAVING COUNT(DISTINCT NULLIF(regexp_replace(semestre::text, '\D', '', 'g'), '')) = 1
) x
WHERE m.id = x.module_id AND m.semestre IS NULL AND x.s BETWEEN 1 AND 10;

-- Contrôle : combien de modules restent sans semestre (à compléter dans Filières) ?
SELECT COUNT(*) AS modules_sans_semestre FROM modules WHERE semestre IS NULL;
