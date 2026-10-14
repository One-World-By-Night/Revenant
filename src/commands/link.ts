import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale, resolvePublicLocale } from '../i18n/index.js';

const STAFF_PING_THROTTLE_MS = 60 * 60 * 1000;

interface LinkResponse {
	status: 'approved' | 'confirmed' | 'requested';
	link_id: number;
	confirm_url?: string;
	expires_at?: string;
}

interface LookupResponse {
	status: string;
	characters: Array<{ id: number; name: string }>;
}

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
	game_name: string;
}

/**
 * Formats an ISO timestamp as a Discord relative timestamp, so each viewer sees it in their own time.
 */
export function formatExpiry(expiresAtIso: string): string {
	const unixSeconds = Math.floor(new Date(expiresAtIso).getTime() / 1000);
	return `<t:${unixSeconds}:R>`;
}

/**
 * Whether the staff channel should hear about a link request again: never yet, or over an hour since
 * the last time this same user's request pinged it.
 */
export function shouldPingStaff(lastPingAt: Date | null, now: Date): boolean {
	if (lastPingAt === null) {
		return true;
	}
	return now.getTime() - lastPingAt.getTime() > STAFF_PING_THROTTLE_MS;
}

function characterList(characters: Array<{ name: string }>): string {
	return characters.map((character) => character.name).join(', ');
}

export const linkCommand = {
	data: new SlashCommandBuilder()
		.setName('link')
		.setDescription('Link your Discord account to your characters in this chronicle')
		.setDescriptionLocalizations({ 'pt-BR': 'Vincula sua conta do Discord aos seus personagens nesta crônica' }) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;

		await interaction.deferReply({ ephemeral: true });

		const { rows } = await context.pool.query<ConnectionRow>(
			'SELECT be_connection_id, secret_enc, rest_root, game_slug, game_name FROM connections WHERE guild_id = $1',
			[guildId]
		);
		const connection = rows[0];
		if (!connection) {
			await interaction.editReply(t(locale, 'disconnect.notConnected'));
			return;
		}

		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const signedAs = { connectionId: String(connection.be_connection_id), secret };

		let result: LinkResponse;
		try {
			result = await callBe<LinkResponse>(connection.rest_root, {
				method: 'POST',
				route: `/be/v1/${connection.game_slug}/bot/links`,
				body: { discord_user_id: interaction.user.id, discord_username: interaction.user.username },
				signedAs,
			});
		} catch (error) {
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/link failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}

		if (result.status === 'approved') {
			const lookup = await callBe<LookupResponse>(connection.rest_root, {
				method: 'GET',
				route: `/be/v1/${connection.game_slug}/bot/links/${interaction.user.id}`,
				signedAs,
			}).catch(() => null);
			const characters = lookup ? characterList(lookup.characters) : '';
			await interaction.editReply(
				characters ? t(locale, 'link.approved', { characters }) : t(locale, 'link.approvedNoCharacters')
			);
			return;
		}

		if (result.status === 'confirmed') {
			await interaction.editReply(t(locale, 'link.confirmed'));
			return;
		}

		if (!result.confirm_url || !result.expires_at) {
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel(t(locale, 'link.openButton')).setStyle(ButtonStyle.Link).setURL(result.confirm_url)
		);
		await interaction.editReply({
			content: t(locale, 'link.requested', { gameName: connection.game_name, expiry: formatExpiry(result.expires_at) }),
			components: [row],
		});

		const settings = await context.pool.query<{ staff_channel_id: string | null; locale: string | null }>(
			'SELECT staff_channel_id, locale FROM guild_settings WHERE guild_id = $1',
			[guildId]
		);
		const staffChannelId = settings.rows[0]?.staff_channel_id;
		if (!staffChannelId) {
			return;
		}
		const publicLocale = resolvePublicLocale(
			settings.rows[0]?.locale ?? null,
			interaction.guild?.preferredLocale ?? null,
			context.config.defaultLocale
		);

		const prefs = await context.pool.query<{ link_ping_at: Date | null }>(
			'SELECT link_ping_at FROM user_prefs WHERE guild_id = $1 AND discord_user_id = $2',
			[guildId, interaction.user.id]
		);
		const lastPingAt = prefs.rows[0]?.link_ping_at ?? null;
		if (!shouldPingStaff(lastPingAt, new Date())) {
			return;
		}

		const channel = await interaction.guild?.channels.fetch(staffChannelId).catch(() => null);
		if (channel?.isTextBased()) {
			await channel.send(t(publicLocale, 'link.staffPing', { username: interaction.user.username }));
		}

		await context.pool.query(
			`INSERT INTO user_prefs (guild_id, discord_user_id, link_ping_at)
			 VALUES ($1, $2, now())
			 ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET link_ping_at = now()`,
			[guildId, interaction.user.id]
		);
	},
};
