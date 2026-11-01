-- Groupes de discussion étudiants : un groupe = UNE filière ET UN niveau.
ALTER TABLE messages_groupe ADD COLUMN IF NOT EXISTS niveau text;

-- Messages existants : rattachés au niveau de leur auteur (étudiant) dans cette filière.
UPDATE messages_groupe mg
SET niveau = e.niveau
FROM etudiants e
WHERE mg.niveau IS NULL
  AND e.user_id = mg.auteur_id
  AND e.filiere_id = mg.filiere_id
  AND COALESCE(e.niveau, '') <> '';

CREATE INDEX IF NOT EXISTS idx_messages_groupe_filiere_niveau ON messages_groupe (filiere_id, niveau, created_at);

-- Reste sans niveau (messages d'un professeur/admin, ou d'un étudiant parti) : invisibles pour les étudiants.
SELECT COUNT(*) AS messages_groupe_sans_niveau FROM messages_groupe WHERE niveau IS NULL;
