-- p49 : photo d'accueil (affichée après la saisie du code de l'établissement).
-- À ne pas confondre avec etablissements.logo_url = logo officiel (bulletins, emplois du temps...).
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS photo_accueil_url text;
