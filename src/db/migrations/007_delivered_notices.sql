CREATE TABLE delivered_notices (
	guild_id text NOT NULL,
	notice_id bigint NOT NULL,
	delivered_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (guild_id, notice_id)
);

CREATE INDEX delivered_notices_delivered_at ON delivered_notices (delivered_at);
