import type { Pool } from 'pg';

export interface ProxiedMessage {
	discordUserId: string;
	characterId: number;
}

export async function recordProxiedMessage(
	pool: Pool,
	guildId: string,
	messageId: string,
	channelId: string,
	discordUserId: string,
	characterId: number
): Promise<void> {
	await pool.query(
		`INSERT INTO proxied_messages (guild_id, message_id, channel_id, discord_user_id, character_id)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (guild_id, message_id) DO UPDATE SET discord_user_id = $4, character_id = $5`,
		[guildId, messageId, channelId, discordUserId, characterId]
	);
}

export async function findProxiedMessage(pool: Pool, guildId: string, messageId: string): Promise<ProxiedMessage | null> {
	const { rows } = await pool.query<{ discord_user_id: string; character_id: number }>(
		'SELECT discord_user_id, character_id FROM proxied_messages WHERE guild_id = $1 AND message_id = $2',
		[guildId, messageId]
	);
	return rows[0] ? { discordUserId: rows[0].discord_user_id, characterId: rows[0].character_id } : null;
}

export async function setTrigger(pool: Pool, guildId: string, discordUserId: string, trigger: string): Promise<void> {
	await pool.query(
		`INSERT INTO posting_triggers (guild_id, discord_user_id, trigger)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET trigger = $3`,
		[guildId, discordUserId, trigger]
	);
}

export async function clearTrigger(pool: Pool, guildId: string, discordUserId: string): Promise<void> {
	await pool.query('DELETE FROM posting_triggers WHERE guild_id = $1 AND discord_user_id = $2', [guildId, discordUserId]);
}

export async function getTrigger(pool: Pool, guildId: string, discordUserId: string): Promise<string | null> {
	const { rows } = await pool.query<{ trigger: string }>(
		'SELECT trigger FROM posting_triggers WHERE guild_id = $1 AND discord_user_id = $2',
		[guildId, discordUserId]
	);
	return rows[0]?.trigger ?? null;
}

export async function setLock(
	pool: Pool,
	guildId: string,
	discordUserId: string,
	channelId: string | null,
	characterId: number
): Promise<void> {
	await pool.query(
		`INSERT INTO posting_locks (guild_id, discord_user_id, channel_id, character_id, locked_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET channel_id = $3, character_id = $4, locked_at = now()`,
		[guildId, discordUserId, channelId, characterId]
	);
}

export async function clearLock(pool: Pool, guildId: string, discordUserId: string): Promise<void> {
	await pool.query('DELETE FROM posting_locks WHERE guild_id = $1 AND discord_user_id = $2', [guildId, discordUserId]);
}

export interface PostingLock {
	channelId: string | null;
	characterId: number;
}

/**
 * The caller's own lock, if it reaches the given channel - a server-wide lock (`channel_id` null)
 * reaches every channel, a channel-scoped one only its own.
 */
export async function getLockForChannel(pool: Pool, guildId: string, discordUserId: string, channelId: string): Promise<PostingLock | null> {
	const { rows } = await pool.query<{ channel_id: string | null; character_id: number }>(
		'SELECT channel_id, character_id FROM posting_locks WHERE guild_id = $1 AND discord_user_id = $2 AND (channel_id IS NULL OR channel_id = $3)',
		[guildId, discordUserId, channelId]
	);
	return rows[0] ? { channelId: rows[0].channel_id, characterId: rows[0].character_id } : null;
}
