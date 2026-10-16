import { WebhookClient, type TextChannel } from 'discord.js';
import type { Pool } from 'pg';
import { encrypt, decrypt } from '../crypto/secretBox.js';

export const WEBHOOK_NAME = 'Revenant Proxy';

interface WebhookRow {
	webhook_id: string;
	webhook_token_enc: Buffer;
}

async function loadWebhook(pool: Pool, guildId: string, channelId: string): Promise<WebhookRow | null> {
	const { rows } = await pool.query<WebhookRow>(
		'SELECT webhook_id, webhook_token_enc FROM channel_webhooks WHERE guild_id = $1 AND channel_id = $2',
		[guildId, channelId]
	);
	return rows[0] ?? null;
}

/**
 * The channel's own Revenant Proxy webhook, creating and storing one (its token encrypted at rest)
 * the first time a character posts in that channel.
 */
export async function getOrCreateWebhook(
	channel: TextChannel,
	pool: Pool,
	secretKey: Buffer,
	guildId: string
): Promise<WebhookClient> {
	const existing = await loadWebhook(pool, guildId, channel.id);
	if (existing) {
		const token = decrypt(existing.webhook_token_enc, secretKey).toString('utf8');
		return new WebhookClient({ id: existing.webhook_id, token });
	}

	const webhook = await channel.createWebhook({ name: WEBHOOK_NAME, reason: 'In-character posting' });
	const token = webhook.token;
	if (!token) {
		throw new Error('created webhook carries no token');
	}
	const tokenEnc = encrypt(Buffer.from(token, 'utf8'), secretKey);
	await pool.query(
		`INSERT INTO channel_webhooks (guild_id, channel_id, webhook_id, webhook_token_enc)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (guild_id, channel_id) DO UPDATE SET webhook_id = $3, webhook_token_enc = $4`,
		[guildId, channel.id, webhook.id, tokenEnc]
	);
	return new WebhookClient({ id: webhook.id, token });
}

export interface CharacterPostProfile {
	display_name: string;
	image_url: string | null;
}

/**
 * Posts a message through the channel's own webhook under a character's name and portrait, and
 * returns the posted message's id for `proxied_messages` to record.
 */
export async function postAsCharacter(
	channel: TextChannel,
	pool: Pool,
	secretKey: Buffer,
	guildId: string,
	profile: CharacterPostProfile,
	content: string
): Promise<string> {
	const webhook = await getOrCreateWebhook(channel, pool, secretKey, guildId);
	const message = await webhook.send({
		username: profile.display_name,
		content,
		...(profile.image_url ? { avatarURL: profile.image_url } : {}),
	});
	return message.id;
}
