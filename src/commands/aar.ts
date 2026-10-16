import {
	SlashCommandBuilder,
	ModalBuilder,
	ActionRowBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	type ChatInputCommandInteraction,
	type AutocompleteInteraction,
	type ModalSubmitInteraction,
} from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { matchingCharacters, activeCharacterId, type LinkedCharacter } from './character.js';
import { getOpenSessionId } from './night.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { createReport } from '../be/gameNight.js';

const AAR_MODAL_ID = 'aar:submit';

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

interface LookupResponse {
	characters: LinkedCharacter[];
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

async function fetchLinkedCharacters(connection: ConnectionRow, secret: Buffer, discordUserId: string): Promise<LookupResponse> {
	return callBe<LookupResponse>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/bot/links/${discordUserId}`,
		signedAs: { connectionId: String(connection.be_connection_id), secret },
	});
}

function reportModal(locale: ReturnType<typeof resolveLocale>): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(AAR_MODAL_ID)
		.setTitle(t(locale, 'aar.modalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('did').setLabel(t(locale, 'aar.fieldDid')).setStyle(TextInputStyle.Paragraph).setRequired(false)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('wants').setLabel(t(locale, 'aar.fieldWants')).setStyle(TextInputStyle.Paragraph).setRequired(false)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('to_staff').setLabel(t(locale, 'aar.fieldToStaff')).setStyle(TextInputStyle.Paragraph).setRequired(false)
			)
		);
}

export const aarCommand: BotCommand = {
	data: new SlashCommandBuilder()
		.setName('aar')
		.setDescription("File an after-action report for tonight's session")
		.setDescriptionLocalizations({ 'pt-BR': 'Registra um relatório de pós-ação para a sessão de hoje' })
		.addStringOption((option) =>
			option
				.setName('character')
				.setDescription('The character (defaults to your active character)')
				.setDescriptionLocalizations({ 'pt-BR': 'O personagem (o padrão é seu personagem ativo)' })
				.setAutocomplete(true)
		) as SlashCommandBuilder,

	async autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
		if (!interaction.inGuild() || !interaction.guildId) {
			await interaction.respond([]);
			return;
		}
		const connection = await loadConnection(context, interaction.guildId);
		if (!connection) {
			await interaction.respond([]);
			return;
		}
		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		try {
			const lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			const matches = matchingCharacters(lookup.characters, interaction.options.getFocused());
			await interaction.respond(matches.map((character) => ({ name: character.name, value: String(character.id) })));
		} catch {
			await interaction.respond([]);
		}
	},

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

		const sessionId = await getOpenSessionId(context, guildId);
		if (sessionId === null) {
			await interaction.reply({ content: t(locale, 'night.noOpenSession'), flags: MessageFlags.Ephemeral });
			return;
		}

		const characterOption = interaction.options.getString('character');
		let characterId: number;
		if (characterOption !== null) {
			characterId = Number(characterOption);
		} else {
			const active = await activeCharacterId(context, interaction);
			if (active === null) {
				await interaction.reply({ content: t(locale, 'sheet.noCharacter'), flags: MessageFlags.Ephemeral });
				return;
			}
			characterId = active;
		}

		await interaction.showModal(reportModal(locale));
		let submitted: ModalSubmitInteraction;
		try {
			submitted = await interaction.awaitModalSubmit({
				filter: (i) => i.customId === AAR_MODAL_ID && i.user.id === interaction.user.id,
				time: 5 * 60 * 1000,
			});
		} catch {
			return;
		}
		await submitted.deferReply({ flags: MessageFlags.Ephemeral });

		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		let characterName: string | null = null;

		try {
			const lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			characterName = lookup.characters.find((character) => character.id === characterId)?.name ?? null;

			await createReport(connection, secret, interaction.user.id, sessionId, characterId, {
				did: submitted.fields.getTextInputValue('did'),
				wants: submitted.fields.getTextInputValue('wants'),
				toStaff: submitted.fields.getTextInputValue('to_staff'),
			});
			await submitted.editReply(t(locale, 'aar.success', { name: characterName ?? `#${characterId}` }));
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await submitted.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			if (error instanceof BeApiError && error.beCode === 'already_exists') {
				await submitted.editReply(t(locale, 'aar.alreadyExists', { name: characterName ?? `#${characterId}` }));
				return;
			}
			if (error instanceof BeApiError && error.beCode === 'reports_closed') {
				await submitted.editReply(t(locale, 'aar.reportsClosed'));
				return;
			}
			if (error instanceof BeApiError && error.beCode === 'session_in_future') {
				await submitted.editReply(t(locale, 'aar.sessionInFuture'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 403) {
				await submitted.editReply(t(locale, 'wound.onlyOwnOrStaff'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 400) {
				await submitted.editReply(t(locale, 'sheet.characterNotFound'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/aar failed');
			await submitted.editReply(t(locale, 'shared.unreachable'));
		}
	},
};
