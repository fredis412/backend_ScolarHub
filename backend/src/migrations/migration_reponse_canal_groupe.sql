-- ============================================================
-- Réponse à un message (style WhatsApp) dans les CANAUX et les
-- GROUPES filière + niveau.
-- Idempotent : peut être relancé sans risque.
-- (Le backend exécute aussi ces deux lignes tout seul au premier
--  besoin ; lancer ce script avant le déploiement reste la voie sûre.)
-- ============================================================
ALTER TABLE messages        ADD COLUMN IF NOT EXISTS reponse_a_id BIGINT;
ALTER TABLE messages_groupe ADD COLUMN IF NOT EXISTS reponse_a_id BIGINT;

-- Vérification : doit renvoyer 2 lignes (messages, messages_groupe)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name = 'reponse_a_id'
  AND table_name IN ('messages', 'messages_groupe');
