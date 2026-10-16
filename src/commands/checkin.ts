import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { matchingCharacters, activeCharacterId, type LinkedCharacter } from './character.js';
import { getOpenSessionId } from './night.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { checkIn } from '../be/gameNight.js';

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

export const checkinCommand: BotCommand = {
	data: new SlashCommandBuilder()
		.setName('checkin')
		.setDescription("Sign your character in at tonight's session")
		.setDescriptionLocalizations({ 'pt-BR': 'Faz check-in do seu personagem na sessão de hoje' })
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

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const sessionId = await getOpenSessionId(context, guildId);
		if (sessionId === null) {
			await interaction.editReply(t(locale, 'night.noOpenSession'));
			return;
		}

		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const characterOption = interaction.options.getString('character');

		let characterId: number;
		let characterName: string | null = null;
		if (characterOption !== null) {
			characterId = Number(characterOption);
		} else {
			const active = await activeCharacterId(context, interaction);
			if (active === null) {
				await interaction.editReply(t(locale, 'sheet.noCharacter'));
				return;
			}
			characterId = active;
		}

		try {
			const lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			characterName = lookup.characters.find((character) => character.id === characterId)?.name ?? null;

			await checkIn(connection, secret, interaction.user.id, sessionId, characterId);
			await interaction.editReply(t(locale, 'checkin.success', { name: characterName ?? `#${characterId}` }));
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			if (error instanceof BeApiError && error.beCode === 'already_signed_in') {
				await interaction.editReply(t(locale, 'checkin.alreadySignedIn', { name: characterName ?? `#${characterId}` }));
				return;
			}
			if (error instanceof BeApiError && error.beCode === 'invalid_candidate') {
				await interaction.editReply(t(locale, 'checkin.invalidCandidate'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 403) {
				await interaction.editReply(t(locale, 'wound.onlyOwnOrStaff'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 400) {
				await interaction.editReply(t(locale, 'sheet.characterNotFound'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/checkin failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
		}
	},
};
