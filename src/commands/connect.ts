import { SlashCommandBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { discoverRestRoot } from '../be/discover.js';
import { callBe, BeApiError } from '../be/client.js';
import { encrypt } from '../crypto/secretBox.js';
import { t, resolveLocale, resolvePublicLocale } from '../i18n/index.js';

interface ConnectResponse {
	connection_id: number;
	secret: string;
	rest_root: string;
	game: { slug: string; name: string };
	be_version: string;
}

/**
 * Upper-cases a typed connect code and drops any spaces or dashes, the way a Storyteller might paste
 * one formatted with dashes.
 */
export function normalizeConnectCode(raw: string): string {
	return raw.toUpperCase().replace(/[\s-]/g, '');
}

export type ConnectOutcomeKey =
	| 'connect.invalidCode'
	| 'connect.alreadyConnected'
	| 'connect.tooOld'
	| 'connect.unreachable';

/**
 * Decides which reply a failed `/connect` attempt gets, from whatever the discovery or BE call threw.
 */
export function classifyConnectFailure(error: unknown): ConnectOutcomeKey {
	if (error instanceof BeApiError) {
		if (error.beCode === 'invalid_code') {
			return 'connect.invalidCode';
		}
		if (error.beCode === 'already_connected') {
			return 'connect.alreadyConnected';
		}
		if (error.httpStatus === 404) {
			return 'connect.tooOld';
		}
	}
	return 'connect.unreachable';
}

export const connectCommand = {
	data: new SlashCommandBuilder()
		.setName('connect')
		.setDescription('Connect this server to a Beyond Elysium chronicle')
		.setDescriptionLocalizations({ 'pt-BR': 'Conecta este servidor a uma crônica do Beyond Elysium' })
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addStringOption((option) =>
			option
				.setName('site')
				.setDescription("The chronicle's site, e.g. mychronicle.com")
				.setDescriptionLocalizations({ 'pt-BR': 'O site da crônica, ex.: minhacronica.com' })
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('code')
				.setDescription('The one-time connect code from Chronicle Setup')
				.setDescriptionLocalizations({ 'pt-BR': 'O código de conexão de uso único de Configuração da Crônica' })
				.setRequired(true)
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);

		if (!interaction.inGuild() || !interaction.guildId) {
			await interaction.reply({ content: t(locale, 'connect.unreachable', { site: '' }), ephemeral: true });
			return;
		}

		await interaction.deferReply({ ephemeral: true });
		const guildId = interaction.guildId;

		const existing = await context.pool.query('SELECT guild_id FROM connections WHERE guild_id = $1', [guildId]);
		if (existing.rows.length > 0) {
			await interaction.editReply(t(locale, 'connect.alreadyConnectedLocally'));
			return;
		}

		const site = interaction.options.getString('site', true);
		const code = normalizeConnectCode(interaction.options.getString('code', true));
		if (code.length !== 12) {
			await interaction.editReply(t(locale, 'connect.invalidCode'));
			return;
		}

		let restRoot: string;
		try {
			restRoot = await discoverRestRoot(site, { allowInsecureLocalhost: context.config.allowInsecureLocalhost });
		} catch (error) {
			context.logger.warn({ site, error: error instanceof Error ? error.message : String(error) }, 'could not reach site for /connect');
			await interaction.editReply(t(locale, 'connect.unreachable', { site }));
			return;
		}

		let result: ConnectResponse;
		try {
			result = await callBe<ConnectResponse>(restRoot, {
				method: 'POST',
				route: '/be/v1/bot/connect',
				body: { code, guild_id: guildId, guild_name: interaction.guild?.name ?? '' },
			});
		} catch (error) {
			const key = classifyConnectFailure(error);
			context.logger.warn({ site, key, error: error instanceof Error ? error.message : String(error) }, '/connect failed');
			await interaction.editReply(t(locale, key, { site }));
			return;
		}

		const secretEnc = encrypt(Buffer.from(result.secret, 'base64url'), context.config.secretKey);
		await context.pool.query(
			`INSERT INTO connections
				(guild_id, site_url, rest_root, be_connection_id, secret_enc, game_slug, game_name, be_version, connected_by, connected_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
			[guildId, site, result.rest_root, result.connection_id, secretEnc, result.game.slug, result.game.name, result.be_version, interaction.user.id]
		);

		await interaction.editReply(t(locale, 'connect.success', { gameName: result.game.name }));

		const settings = await context.pool.query<{ staff_channel_id: string | null; locale: string | null }>(
			'SELECT staff_channel_id, locale FROM guild_settings WHERE guild_id = $1',
			[guildId]
		);
		const staffChannelId = settings.rows[0]?.staff_channel_id;
		if (staffChannelId) {
			const channel = await interaction.guild?.channels.fetch(staffChannelId).catch(() => null);
			if (channel?.isTextBased()) {
				const publicLocale = resolvePublicLocale(
					settings.rows[0]?.locale ?? null,
					interaction.guild?.preferredLocale ?? null,
					context.config.defaultLocale
				);
				await channel.send(t(publicLocale, 'connect.success', { gameName: result.game.name }));
			}
		}
	},
};
