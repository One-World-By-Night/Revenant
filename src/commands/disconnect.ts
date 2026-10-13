import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';

const CONFIRM_ID = 'disconnect:confirm';
const CANCEL_ID = 'disconnect:cancel';
const CONFIRM_TIMEOUT_MS = 30_000;

export type DisconnectOutcome = 'success' | 'endedFromSite' | 'successWithNote';

/**
 * Decides what to tell the user once the server's connection and preferences are deleted locally,
 * from whatever the signed disconnect call threw - or `null` when it answered cleanly.
 */
export function classifyDisconnectOutcome(error: unknown): DisconnectOutcome {
	if (error === null) {
		return 'success';
	}
	if (error instanceof BeApiError && error.kind === 'auth_failed') {
		return 'endedFromSite';
	}
	return 'successWithNote';
}

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

export const disconnectCommand = {
	data: new SlashCommandBuilder()
		.setName('disconnect')
		.setDescription("Disconnect this server from its chronicle's site")
		.setDescriptionLocalizations({ 'pt-BR': 'Desconecta este servidor do site da crônica dele' })
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);

		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;

		const { rows } = await context.pool.query<ConnectionRow>(
			'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
			[guildId]
		);
		const connection = rows[0];
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), ephemeral: true });
			return;
		}

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel(t(locale, 'disconnect.confirmButton')).setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId(CANCEL_ID).setLabel(t(locale, 'disconnect.cancelButton')).setStyle(ButtonStyle.Secondary)
		);
		const reply = await interaction.reply({
			content: t(locale, 'disconnect.confirmPrompt'),
			components: [row],
			ephemeral: true,
			fetchReply: true,
		});

		let buttonInteraction;
		try {
			buttonInteraction = await reply.awaitMessageComponent({
				filter: (i) => i.user.id === interaction.user.id,
				time: CONFIRM_TIMEOUT_MS,
			});
		} catch {
			await interaction.editReply({ content: t(locale, 'disconnect.cancelled'), components: [] });
			return;
		}

		if (buttonInteraction.customId === CANCEL_ID) {
			await buttonInteraction.update({ content: t(locale, 'disconnect.cancelled'), components: [] });
			return;
		}

		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		let callError: unknown = null;
		try {
			await callBe(connection.rest_root, {
				method: 'POST',
				route: `/be/v1/${connection.game_slug}/bot/disconnect`,
				signedAs: { connectionId: String(connection.be_connection_id), secret },
			});
		} catch (error) {
			callError = error;
			context.logger.warn(
				{ guildId, error: error instanceof Error ? error.message : String(error) },
				'/disconnect call to BE did not succeed'
			);
		}

		await context.pool.query('DELETE FROM connections WHERE guild_id = $1', [guildId]);
		await context.pool.query('DELETE FROM user_prefs WHERE guild_id = $1', [guildId]);

		const outcome = classifyDisconnectOutcome(callError);
		const content =
			outcome === 'endedFromSite'
				? t(locale, 'shared.connectionEndedFromSite')
				: outcome === 'successWithNote'
					? `${t(locale, 'disconnect.success')} ${t(locale, 'disconnect.beUnreachableNote')}`
					: t(locale, 'disconnect.success');

		await buttonInteraction.update({ content, components: [] });
	},
};
