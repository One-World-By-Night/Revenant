import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { findSessionForDate, createSession, closeSession, SessionAlreadyExistsError, type SessionRow } from '../be/temporaryState.js';

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

/**
 * Today's date in `YYYY-MM-DD`, UTC. The chronicle's own site timezone would be the correct source -
 * no existing BE route exposes it, so a Storyteller whose local date differs can override it with
 * the `date` option.
 */
export function todayUtcDate(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

async function requireStoryteller(
	connection: ConnectionRow,
	secret: Buffer,
	discordUserId: string
): Promise<boolean> {
	const capabilities = await callBe<{ capabilities: Record<string, boolean> }>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/my/capabilities`,
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
	return Boolean(capabilities.capabilities.be_manage_sessions);
}

async function setOpenSessionId(context: CommandContext, guildId: string, sessionId: number | null): Promise<void> {
	await context.pool.query(
		`INSERT INTO guild_settings (guild_id, open_session_id) VALUES ($1, $2)
		 ON CONFLICT (guild_id) DO UPDATE SET open_session_id = $2`,
		[guildId, sessionId]
	);
}

export async function getOpenSessionId(context: CommandContext, guildId: string): Promise<number | null> {
	const { rows } = await context.pool.query<{ open_session_id: number | null }>(
		'SELECT open_session_id FROM guild_settings WHERE guild_id = $1',
		[guildId]
	);
	return rows[0]?.open_session_id ?? null;
}

async function openNight(
	interaction: ChatInputCommandInteraction,
	context: CommandContext,
	connection: ConnectionRow,
	secret: Buffer
): Promise<void> {
	const locale = resolveLocale(interaction.locale);
	const guildId = interaction.guildId!;
	const date = interaction.options.getString('date') ?? todayUtcDate();

	let session: SessionRow;
	try {
		session = await createSession(connection, secret, interaction.user.id, date);
	} catch (error) {
		if (error instanceof SessionAlreadyExistsError) {
			const existing = await findSessionForDate(connection, secret, interaction.user.id, date);
			if (!existing) {
				await interaction.editReply(t(locale, 'shared.unreachable'));
				return;
			}
			session = existing;
		} else {
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/night open failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}
	}

	await setOpenSessionId(context, guildId, session.id);
	await interaction.editReply(t(locale, 'night.openSuccess'));
}

async function closeNight(
	interaction: ChatInputCommandInteraction,
	context: CommandContext,
	connection: ConnectionRow,
	secret: Buffer
): Promise<void> {
	const locale = resolveLocale(interaction.locale);
	const guildId = interaction.guildId!;

	const sessionId = await getOpenSessionId(context, guildId);
	if (sessionId === null) {
		await interaction.editReply(t(locale, 'night.noOpenSession'));
		return;
	}

	try {
		await closeSession(connection, secret, interaction.user.id, sessionId);
	} catch (error) {
		context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/night close failed');
		await interaction.editReply(t(locale, 'shared.unreachable'));
		return;
	}

	await setOpenSessionId(context, guildId, null);
	await interaction.editReply(t(locale, 'night.closeSuccess'));
}

export const nightCommand = {
	data: new SlashCommandBuilder()
		.setName('night')
		.setDescription("Open or close tonight's session")
		.setDescriptionLocalizations({ 'pt-BR': 'Abre ou encerra a sessão de hoje' })
		.addSubcommand((sub) =>
			sub
				.setName('open')
				.setDescription("Open tonight's session")
				.setDescriptionLocalizations({ 'pt-BR': 'Abre a sessão de hoje' })
				.addStringOption((option) =>
					option
						.setName('date')
						.setDescription('YYYY-MM-DD, defaults to today')
						.setDescriptionLocalizations({ 'pt-BR': 'AAAA-MM-DD, o padrão é hoje' })
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName('close')
				.setDescription("Close tonight's session")
				.setDescriptionLocalizations({ 'pt-BR': 'Encerra a sessão de hoje' })
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const secret = decrypt(connection.secret_enc, context.config.secretKey);

		let isStoryteller: boolean;
		try {
			isStoryteller = await requireStoryteller(connection, secret, interaction.user.id);
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/night failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}
		if (!isStoryteller) {
			await interaction.editReply(t(locale, 'shared.storytellersOnly'));
			return;
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'open') {
			await openNight(interaction, context, connection, secret);
			return;
		}
		await closeNight(interaction, context, connection, secret);
	},
};
