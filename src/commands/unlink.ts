import {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';

const CONFIRM_ID = 'unlink:confirm';
const CANCEL_ID = 'unlink:cancel';
const CONFIRM_TIMEOUT_MS = 30_000;

export type UnlinkOutcome = 'success' | 'notLinked' | 'error';

/**
 * Decides what to tell the player and whether their local active character should clear, from
 * whatever the signed unlink call threw - or `null` when it answered cleanly.
 */
export function classifyUnlinkOutcome(error: unknown): UnlinkOutcome {
	if (error === null) {
		return 'success';
	}
	if (error instanceof BeApiError && error.kind === 'user_not_linked') {
		return 'notLinked';
	}
	return 'error';
}

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

export const unlinkCommand = {
	data: new SlashCommandBuilder()
		.setName('unlink')
		.setDescription('Unlink your Discord account from this chronicle')
		.setDescriptionLocalizations({ 'pt-BR': 'Desvincula sua conta do Discord desta crônica' }) as SlashCommandBuilder,

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
			new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel(t(locale, 'unlink.confirmButton')).setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId(CANCEL_ID).setLabel(t(locale, 'unlink.cancelButton')).setStyle(ButtonStyle.Secondary)
		);
		const reply = await interaction.reply({
			content: t(locale, 'unlink.confirmPrompt'),
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
			await interaction.editReply({ content: t(locale, 'unlink.cancelled'), components: [] });
			return;
		}

		if (buttonInteraction.customId === CANCEL_ID) {
			await buttonInteraction.update({ content: t(locale, 'unlink.cancelled'), components: [] });
			return;
		}

		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		let callError: unknown = null;
		try {
			await callBe(connection.rest_root, {
				method: 'DELETE',
				route: `/be/v1/${connection.game_slug}/discord-links/mine`,
				signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: interaction.user.id },
			});
		} catch (error) {
			callError = error;
			context.logger.warn(
				{ guildId, error: error instanceof Error ? error.message : String(error) },
				'/unlink call to BE did not succeed'
			);
		}

		const outcome = classifyUnlinkOutcome(callError);
		if (outcome === 'success') {
			await context.pool.query(
				'UPDATE user_prefs SET active_character_id = NULL WHERE guild_id = $1 AND discord_user_id = $2',
				[guildId, interaction.user.id]
			);
		}

		const content =
			outcome === 'notLinked'
				? t(locale, 'shared.userNotLinked')
				: outcome === 'error'
					? t(locale, 'unlink.error')
					: t(locale, 'unlink.success');

		await buttonInteraction.update({ content, components: [] });
	},
};
