import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { matchingCharacters, activeCharacterId, type LinkedCharacter } from './character.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { discoverPools, readWounds, readNightLosses, fetchCharacterRaw } from '../be/temporaryState.js';
import { buildStatusEmbed } from '../render/status.js';

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

interface SearchedCharacter {
	id: number;
	name: string;
}

interface LookupResponse {
	staff: boolean;
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

async function searchCharacters(
	connection: ConnectionRow,
	secret: Buffer,
	discordUserId: string,
	search: string
): Promise<SearchedCharacter[]> {
	return callBe<SearchedCharacter[]>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/characters`,
		query: { search, per_page: '25' },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

export const statusCommand = {
	data: new SlashCommandBuilder()
		.setName('status')
		.setDescription("Show a character's tonight: pools, wounds and losses")
		.setDescriptionLocalizations({ 'pt-BR': 'Mostra a noite de um personagem: reservas, feridas e perdas' })
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
		const focused = interaction.options.getFocused();

		try {
			const lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			if (lookup.staff) {
				const found = await searchCharacters(connection, secret, interaction.user.id, focused);
				await interaction.respond(found.map((character) => ({ name: character.name, value: String(character.id) })));
				return;
			}
			const matches = matchingCharacters(lookup.characters, focused);
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

		const characterOption = interaction.options.getString('character');

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const secret = decrypt(connection.secret_enc, context.config.secretKey);

		let characterId: number;
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
			const character = await fetchCharacterRaw(connection, secret, interaction.user.id, characterId);
			const pools = discoverPools(character.sheet_data);
			const wounds = readWounds(character.sheet_data);
			const losses = readNightLosses(character.sheet_data);
			const embed = buildStatusEmbed(locale, character.name, pools, wounds, losses);
			await interaction.editReply({ embeds: [embed] });
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 403) {
				await interaction.editReply(t(locale, 'sheet.forbidden'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 404) {
				await interaction.editReply(t(locale, 'sheet.characterNotFound'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/status failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
		}
	},
};
