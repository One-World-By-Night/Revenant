import { ChannelType, type Message, type TextChannel } from 'discord.js';
import type { CommandContext } from '../commands/registry.js';
import { decrypt } from '../crypto/secretBox.js';
import { fetchPostingProfile } from '../be/postingProfile.js';
import { postAsCharacter } from './webhooks.js';
import { getLockForChannel, getTrigger, recordProxiedMessage } from '../posting/store.js';
import type { Connection } from '../be/temporaryState.js';

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

async function activeCharacterId(context: CommandContext, guildId: string, discordUserId: string): Promise<number | null> {
	const { rows } = await context.pool.query<{ active_character_id: number | null }>(
		'SELECT active_character_id FROM user_prefs WHERE guild_id = $1 AND discord_user_id = $2',
		[guildId, discordUserId]
	);
	return rows[0]?.active_character_id ?? null;
}

/**
 * Reposts a plain message as a character when the author has an active lock or a matching trigger,
 * and deletes the original - inert until the Message Content and Guild Messages gateway intents are
 * both turned on, since neither the event nor the real text reaches the bot without them.
 */
export async function handleMessageCreate(message: Message, context: CommandContext): Promise<void> {
	if (message.author.bot || !message.inGuild() || !message.guildId) {
		return;
	}
	if (!message.channel.isTextBased() || message.channel.type !== ChannelType.GuildText) {
		return;
	}
	const guildId = message.guildId;

	const connection = await loadConnection(context, guildId);
	if (!connection) {
		return;
	}

	const lock = await getLockForChannel(context.pool, guildId, message.author.id, message.channelId);
	let characterId: number | null;
	let content: string;

	if (lock) {
		characterId = lock.characterId;
		content = message.content;
	} else {
		const trigger = await getTrigger(context.pool, guildId, message.author.id);
		if (!trigger || !message.content.startsWith(trigger)) {
			return;
		}
		content = message.content.slice(trigger.length).trim();
		if (content.length === 0) {
			return;
		}
		characterId = await activeCharacterId(context, guildId, message.author.id);
		if (characterId === null) {
			return;
		}
	}

	const secret = decrypt(connection.secret_enc, context.config.secretKey);
	const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };

	let profile;
	try {
		profile = await fetchPostingProfile(beConnection, secret, message.author.id, characterId);
	} catch {
		return;
	}

	const channel = message.channel as TextChannel;
	const messageId = await postAsCharacter(channel, context.pool, context.config.secretKey, guildId, profile, content);
	await recordProxiedMessage(context.pool, guildId, messageId, message.channelId, message.author.id, characterId);
	await message.delete().catch(() => undefined);
}
