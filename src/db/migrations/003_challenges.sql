CREATE TABLE challenges (
	id bigserial PRIMARY KEY,
	guild_id text NOT NULL,
	channel_id text NOT NULL,
	kind text NOT NULL,
	status text NOT NULL,
	challenger_discord_id text NOT NULL,
	defender_discord_id text,
	narrator_discord_id text,
	category text,
	conditions text NOT NULL,
	state jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz,
	settled_at timestamptz
);

CREATE TABLE challenge_costs (
	id bigserial PRIMARY KEY,
	challenge_id bigint NOT NULL REFERENCES challenges (id),
	kind text NOT NULL,
	payload jsonb NOT NULL,
	be_change_id integer,
	reversed_at timestamptz
);
