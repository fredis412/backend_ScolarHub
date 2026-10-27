-- ════════════════════════════════════════════════════════════════════════════
-- Messagerie : messages épinglés (canal / groupe filière / privé)
-- À exécuter UNE FOIS dans Supabase avant de redémarrer le backend.
-- (La table `reactions` existe déjà et accepte message_type = 'prive' : rien à créer.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages_epingles (
    message_id    integer      NOT NULL,
    message_type  varchar(10)  NOT NULL,          -- 'canal' | 'groupe' | 'prive'
    epingle_par   uuid,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, message_type)
);
