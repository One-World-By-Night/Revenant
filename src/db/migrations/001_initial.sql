CREATE TABLE connections (
	guild_id text PRIMARY KEY,
	site_url text NOT NULL,
	rest_root text NOT NULL,
	be_connection_id integer NOT NULL,
	secret_enc bytea NOT NULL,
	game_slug text NOT NULL,
	game_name text NOT NULL,
	be_version text,
	features jsonb,
	connected_by text NOT NULL,
	connected_at timestamptz NOT NULL DEFAULT now(),
	status_checked_at timestamptz
);

CREATE TABLE user_prefs (
	guild_id text NOT NULL,
	discord_user_id text NOT NULL,
	active_character_id integer,
	link_ping_at timestamptz,
	PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE guild_settings (
	guild_id text PRIMARY KEY,
	pool_rules text NOT NULL DEFAULT 'revised',
	staff_channel_id text,
	locale text
);

CREATE TABLE dice_log (
	id bigserial PRIMARY KEY,
	guild_id text NOT NULL,
	channel_id text NOT NULL,
	discord_user_id text NOT NULL,
	expression text NOT NULL,
	result jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
