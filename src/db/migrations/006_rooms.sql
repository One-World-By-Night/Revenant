ALTER TABLE guild_settings ADD COLUMN role_sync_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE guild_settings ADD COLUMN player_role_id text;
ALTER TABLE guild_settings ADD COLUMN narrator_role_id text;
ALTER TABLE guild_settings ADD COLUMN storyteller_role_id text;
