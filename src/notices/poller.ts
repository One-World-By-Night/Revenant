import { ChannelType, type Client, type TextChannel } from 'discord.js';
import type { Pool } from 'pg';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';
import { decrypt } from '../crypto/secretBox.js';
import { fetchNotices, ackNotices } from '../be/notices.js';
import { fetchApprovedLinksForRouting } from '../be/rooms.js';
import { resolveDestination } from './route.js';
import { formatNotice } from '../render/notices.js';
import { resolveLocale } from '../i18n/index.js';
import type { Connection } from '../be/temporaryState.js';

const DEFAULT_POLL_SECONDS = 30;

interface ConnectionRow {
	guild_id: string;
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

async function deliver(client: Client, channelId: string, text: string): Promise<boolean> {
	const channel = await client.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased() || channel.type !== ChannelType.GuildText) {
		return false;
	}
	await (channel as TextChannel).send(text);
	return true;
}

async function deliverDm(client: Client, discordUserId: string, text: string): Promise<boolean> {
	const user = await client.users.fetch(discordUserId).catch(() => null);
	if (!user) {
		return false;
	}
	await user.send(text).catch(() => undefined);
	return true;
}

async function pollGuild(client: Client, pool: Pool, config: Config, logger: Logger, row: ConnectionRow): Promise<void> {
	const secret = decrypt(row.secret_enc, config.secretKey);
	const connection: Connection = { be_connection_id: row.be_connection_id, rest_root: row.rest_root, game_slug: row.game_slug };

	const notices = await fetchNotices(connection, secret);
	if (notices.length === 0) {
		return;
	}

	const links = await fetchApprovedLinksForRouting(connection, secret);
	const { rows: settingsRows } = await pool.query<{ staff_channel_id: string | null; locale: string | null }>(
		'SELECT staff_channel_id, locale FROM guild_settings WHERE guild_id = $1',
		[row.guild_id]
	);
	const staffChannelId = settingsRows[0]?.staff_channel_id ?? null;
	const locale = resolveLocale(settingsRows[0]?.locale ?? undefined);

	const delivered: number[] = [];
	for (const notice of notices) {
		const destination = resolveDestination(notice, links);
		const text = formatNotice(locale, notice);
		try {
			if (destination.kind === 'room') {
				await deliver(client, destination.channelId, text);
			} else if (destination.kind === 'dm') {
				await deliverDm(client, destination.discordUserId, text);
			} else if (destination.kind === 'staff') {
				if (staffChannelId) {
					await deliver(client, staffChannelId, text);
				}
			}
		} catch (error) {
			logger.warn(
				{ guildId: row.guild_id, noticeId: notice.id, error: error instanceof Error ? error.message : String(error) },
				'failed to deliver a notice'
			);
		}
		// Acknowledged either way - a delivery failure (a deleted room, a closed DM, no staff channel
		// configured) should not hold the same notice forever.
		delivered.push(notice.id);
	}

	await ackNotices(connection, secret, delivered);
}

/**
 * Starts the recurring poll: every chronicle's own undelivered notices, read and delivered on the
 * interval `EVENT_POLL_SECONDS` names (30s when unset).
 */
export function startNoticePoller(client: Client, pool: Pool, config: Config, logger: Logger): void {
	const intervalMs = (config.eventPollSeconds ?? DEFAULT_POLL_SECONDS) * 1000;

	setInterval(() => {
		pool
			.query<ConnectionRow>('SELECT guild_id, be_connection_id, secret_enc, rest_root, game_slug FROM connections')
			.then(async ({ rows }) => {
				for (const row of rows) {
					try {
						await pollGuild(client, pool, config, logger, row);
					} catch (error) {
						logger.warn(
							{ guildId: row.guild_id, error: error instanceof Error ? error.message : String(error) },
							'notice poll failed for this guild'
						);
					}
				}
			})
			.catch((error: unknown) => {
				logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'notice poll failed');
			});
	}, intervalMs);
}
