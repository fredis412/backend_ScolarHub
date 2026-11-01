-- ScolarHub — Emails par établissement + code de réinitialisation haché (p49)
-- À exécuter UNE FOIS dans Supabase (SQL Editor). Sans effet si déjà fait.
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS email_contact text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_essais integer NOT NULL DEFAULT 0;
