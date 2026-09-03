-- ==============================================================================
-- MIGRATION : Refonte Messagerie (Accusés de lecture & Canaux standards)
-- ==============================================================================

-- 1. Ajout de l'accusé de lecture pour les messages privés
ALTER TABLE messages_prives ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- 2. Création/Mise à jour des Canaux de l'Administration & Professeurs
-- On s'assure qu'ils n'existent pas en double en se basant sur le type
DELETE FROM canaux WHERE type IN ('admin_profs', 'admin_delegues', 'prof_prof');

INSERT INTO canaux (nom, description, type) VALUES
('Administration & Professeurs', 'Canal officiel Admin ↔ Tous les professeurs', 'admin_profs'),
('Administration & Délégués', 'Canal officiel Admin ↔ Délégués', 'admin_delegues'),
('Salle des Professeurs', 'Canal de discussion entre professeurs', 'prof_prof');

-- 3. Ajout du super admin dans ces groupes (pour garantir au moins 1 membre admin)
INSERT INTO canal_membres (canal_id, user_id, role)
SELECT c.id, u.id, 'admin'
FROM canaux c
CROSS JOIN users u
WHERE c.type IN ('admin_profs', 'admin_delegues') 
  AND u.role = 'admin'
ON CONFLICT (canal_id, user_id) DO NOTHING;

-- Les professeurs existants doivent aussi être ajoutés à admin_profs et prof_prof
INSERT INTO canal_membres (canal_id, user_id, role)
SELECT c.id, u.id, 'membre'
FROM canaux c
CROSS JOIN users u
WHERE c.type IN ('admin_profs', 'prof_prof') 
  AND u.role = 'professeur'
ON CONFLICT (canal_id, user_id) DO NOTHING;
