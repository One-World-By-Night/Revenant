CREATE TABLE channel_webhooks (
	guild_id text NOT NULL,
	channel_id text NOT NULL,
	webhook_id text NOT NULL,
	webhook_token_enc bytea NOT NULL,
	PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE posting_triggers (
	guild_id text NOT NULL,
	discord_user_id text NOT NULL,
	trigger text NOT NULL,
	PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE posting_locks (
	guild_id text NOT NULL,
	discord_user_id text NOT NULL,
	channel_id text,
	character_id integer NOT NULL,
	locked_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE proxied_messages (
	guild_id text NOT NULL,
	message_id text NOT NULL,
	channel_id text NOT NULL,
	discord_user_id text NOT NULL,
	character_id integer NOT NULL,
	posted_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (guild_id, message_id)
);
