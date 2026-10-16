import {
	SlashCommandBuilder,
	ChannelType,
	PermissionFlagsBits,
	MessageFlags,
	type ChatInputCommandInteraction,
	type TextChannel,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale, type Locale } from '../i18n/index.js';
import type { PoolRules } from '../dice/pools.js';

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

export interface GuildSettingsRow {
	pool_rules: PoolRules;
	staff_channel_id: string | null;
	locale: string | null;
	trait_cap: number | null;
	challenge_timeout_minutes: number;
	role_sync_enabled: boolean;
	player_role_id: string | null;
	narrator_role_id: string | null;
	storyteller_role_id: string | null;
}

/**
 * The rule set's own display name - a proper noun from the books, not translated.
 */
export function describePoolRules(rules: PoolRules): string {
	return rules === 'v20' ? 'V20' : 'Revised';
}

/**
 * A saved locale's display name, or the "server's Discord language" phrase when none is saved.
 */
export function describeLanguage(locale: Locale, storedLocale: string | null): string {
	if (storedLocale === 'pt-BR') {
		return 'Portuguese (Brazil)';
	}
	if (storedLocale === 'en-US') {
		return 'English (US)';
	}
	return t(locale, 'settings.languageDefault');
}

/**
 * What `guild_settings.locale` should hold for a `language` choice - null clears it back to "default".
 */
export function languageChoiceToStoredLocale(choice: string): string | null {
	return choice === 'default' ? null : choice;
}

function describeRole(roleId: string | null, locale: Locale): string {
	return roleId ? `<@&${roleId}>` : t(locale, 'settings.none');
}

export function formatSettingsSummary(
	locale: Locale,
	settings: {
		poolRules: PoolRules;
		staffChannelId: string | null;
		storedLocale: string | null;
		traitCap: number | null;
		challengeTimeoutMinutes: number;
		roleSyncEnabled: boolean;
		playerRoleId: string | null;
		narratorRoleId: string | null;
		storytellerRoleId: string | null;
	}
): string {
	return t(locale, 'settings.summary', {
		poolRules: describePoolRules(settings.poolRules),
		staffChannel: settings.staffChannelId ? `<#${settings.staffChannelId}>` : t(locale, 'settings.none'),
		language: describeLanguage(locale, settings.storedLocale),
		traitCap: settings.traitCap ?? t(locale, 'settings.none'),
		challengeTimeout: settings.challengeTimeoutMinutes,
		roleSync: t(locale, settings.roleSyncEnabled ? 'settings.on' : 'settings.off'),
		playerRole: describeRole(settings.playerRoleId, locale),
		narratorRole: describeRole(settings.narratorRoleId, locale),
		storytellerRole: describeRole(settings.storytellerRoleId, locale),
	});
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

export async function loadGuildSettings(context: CommandContext, guildId: string): Promise<GuildSettingsRow> {
	const { rows } = await context.pool.query<GuildSettingsRow>(
		`SELECT pool_rules, staff_channel_id, locale, trait_cap, challenge_timeout_minutes,
		        role_sync_enabled, player_role_id, narrator_role_id, storyteller_role_id
		 FROM guild_settings WHERE guild_id = $1`,
		[guildId]
	);
	return (
		rows[0] ?? {
			pool_rules: 'revised',
			staff_channel_id: null,
			locale: null,
			trait_cap: null,
			challenge_timeout_minutes: 60,
			role_sync_enabled: false,
			player_role_id: null,
			narrator_role_id: null,
			storyteller_role_id: null,
		}
	);
}

export const settingsCommand = {
	data: new SlashCommandBuilder()
		.setName('settings')
		.setDescription("Show or change this chronicle's bot settings")
		.setDescriptionLocalizations({ 'pt-BR': 'Mostra ou muda as configurações do bot para esta crônica' })
		.addStringOption((option) =>
			option
				.setName('pool_rules')
				.setDescription('Which World of Darkness pool rules /roll uses')
				.setDescriptionLocalizations({ 'pt-BR': 'Quais regras de reserva o /roll usa' })
				.addChoices(
					{ name: 'Revised', value: 'revised' },
					{ name: 'V20', value: 'v20' }
				)
		)
		.addChannelOption((option) =>
			option
				.setName('staff_channel')
				.setDescription('Where staff notices are posted')
				.setDescriptionLocalizations({ 'pt-BR': 'Onde os avisos da equipe são publicados' })
				.addChannelTypes(ChannelType.GuildText)
		)
		.addStringOption((option) =>
			option
				.setName('language')
				.setDescription("The server's language for public posts")
				.setDescriptionLocalizations({ 'pt-BR': 'O idioma do servidor para publicações públicas' })
				.addChoices(
					{ name: 'English (US)', value: 'en-US', name_localizations: { 'pt-BR': 'Inglês (EUA)' } },
					{ name: 'Portuguese (Brazil)', value: 'pt-BR', name_localizations: { 'pt-BR': 'Português (Brasil)' } },
					{
						name: "Default (Discord's own server language)",
						value: 'default',
						name_localizations: { 'pt-BR': 'Padrão (o idioma do Discord do servidor)' },
					}
				)
		)
		.addIntegerOption((option) =>
			option
				.setName('trait_cap')
				.setDescription('The most Traits a challenge claim may name - 0 clears it, leave unset for no cap')
				.setDescriptionLocalizations({ 'pt-BR': 'O máximo de Traits que uma reivindicação pode declarar - 0 remove o limite' })
				.setMinValue(0)
		)
		.addIntegerOption((option) =>
			option
				.setName('challenge_timeout')
				.setDescription('Minutes before an unanswered challenge expires')
				.setDescriptionLocalizations({ 'pt-BR': 'Minutos até um desafio sem resposta expirar' })
				.setMinValue(1)
		)
		.addStringOption((option) =>
			option
				.setName('role_sync')
				.setDescription('Whether /room gives a linked player their Player, Narrator or Storyteller role')
				.setDescriptionLocalizations({ 'pt-BR': 'Se o /room dá ao jogador vinculado seu cargo de Jogador, Narrador ou Narrador-chefe' })
				.addChoices(
					{ name: 'On', value: 'on', name_localizations: { 'pt-BR': 'Ativado' } },
					{ name: 'Off', value: 'off', name_localizations: { 'pt-BR': 'Desativado' } }
				)
		)
		.addRoleOption((option) =>
			option
				.setName('player_role')
				.setDescription('The role role sync gives a plain player')
				.setDescriptionLocalizations({ 'pt-BR': 'O cargo que a sincronização dá a um jogador comum' })
		)
		.addRoleOption((option) =>
			option
				.setName('narrator_role')
				.setDescription('The role role sync gives a Narrator')
				.setDescriptionLocalizations({ 'pt-BR': 'O cargo que a sincronização dá a um Narrador' })
		)
		.addRoleOption((option) =>
			option
				.setName('storyteller_role')
				.setDescription('The role role sync gives a Storyteller')
				.setDescriptionLocalizations({ 'pt-BR': 'O cargo que a sincronização dá a um Narrador-chefe' })
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

		let capabilities: { capabilities: Record<string, boolean> };
		try {
			capabilities = await callBe(connection.rest_root, {
				method: 'GET',
				route: `/be/v1/${connection.game_slug}/my/capabilities`,
				signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: interaction.user.id },
			});
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/settings failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}
		if (!capabilities.capabilities.be_manage_characters) {
			await interaction.editReply(t(locale, 'shared.storytellersOnly'));
			return;
		}

		const poolRulesOption = interaction.options.getString('pool_rules') as PoolRules | null;
		const staffChannelOption = interaction.options.getChannel('staff_channel') as TextChannel | null;
		const languageOption = interaction.options.getString('language');
		const traitCapOption = interaction.options.getInteger('trait_cap');
		const challengeTimeoutOption = interaction.options.getInteger('challenge_timeout');
		const roleSyncOption = interaction.options.getString('role_sync');
		const playerRoleOption = interaction.options.getRole('player_role');
		const narratorRoleOption = interaction.options.getRole('narrator_role');
		const storytellerRoleOption = interaction.options.getRole('storyteller_role');

		if (staffChannelOption) {
			const permissions = staffChannelOption.permissionsFor(interaction.client.user);
			if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
				await interaction.editReply(t(locale, 'settings.staffChannelUnreachable', { channel: `<#${staffChannelOption.id}>` }));
				return;
			}
		}

		await context.pool.query('INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING', [guildId]);

		const updates: string[] = [];
		const params: unknown[] = [guildId];
		if (poolRulesOption !== null) {
			params.push(poolRulesOption);
			updates.push(`pool_rules = $${params.length}`);
		}
		if (staffChannelOption !== null) {
			params.push(staffChannelOption.id);
			updates.push(`staff_channel_id = $${params.length}`);
		}
		if (languageOption !== null) {
			params.push(languageChoiceToStoredLocale(languageOption));
			updates.push(`locale = $${params.length}`);
		}
		if (traitCapOption !== null) {
			params.push(traitCapOption === 0 ? null : traitCapOption);
			updates.push(`trait_cap = $${params.length}`);
		}
		if (challengeTimeoutOption !== null) {
			params.push(challengeTimeoutOption);
			updates.push(`challenge_timeout_minutes = $${params.length}`);
		}
		if (roleSyncOption !== null) {
			params.push(roleSyncOption === 'on');
			updates.push(`role_sync_enabled = $${params.length}`);
		}
		if (playerRoleOption !== null) {
			params.push(playerRoleOption.id);
			updates.push(`player_role_id = $${params.length}`);
		}
		if (narratorRoleOption !== null) {
			params.push(narratorRoleOption.id);
			updates.push(`narrator_role_id = $${params.length}`);
		}
		if (storytellerRoleOption !== null) {
			params.push(storytellerRoleOption.id);
			updates.push(`storyteller_role_id = $${params.length}`);
		}
		if (updates.length > 0) {
			await context.pool.query(`UPDATE guild_settings SET ${updates.join(', ')} WHERE guild_id = $1`, params);
		}

		const settings = await loadGuildSettings(context, guildId);
		const summary = formatSettingsSummary(locale, {
			poolRules: settings.pool_rules,
			staffChannelId: settings.staff_channel_id,
			storedLocale: settings.locale,
			traitCap: settings.trait_cap,
			challengeTimeoutMinutes: settings.challenge_timeout_minutes,
			roleSyncEnabled: settings.role_sync_enabled,
			playerRoleId: settings.player_role_id,
			narratorRoleId: settings.narrator_role_id,
			storytellerRoleId: settings.storyteller_role_id,
		});
		await interaction.editReply(updates.length > 0 ? t(locale, 'settings.updated', { summary }) : summary);
	},
};
