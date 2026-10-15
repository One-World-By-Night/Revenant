ALTER TABLE guild_settings ADD COLUMN trait_cap integer;
ALTER TABLE guild_settings ADD COLUMN challenge_timeout_minutes integer NOT NULL DEFAULT 60;
