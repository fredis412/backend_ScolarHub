-- p48 : mot de passe provisoire à changer à la première connexion.
-- (Le logo utilise la colonne etablissements.logo_url, déjà créée par la migration multi-établissement.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mdp_a_changer boolean NOT NULL DEFAULT false;
