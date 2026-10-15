import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { matchingCharacters, activeCharacterId, type LinkedCharacter } from './character.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale, type Locale } from '../i18n/index.js';
import { takeWound, healWound, type Wounds, type WoundType } from '../be/temporaryState.js';

const WOUND_TYPES = ['bashing', 'lethal', 'aggravated'] as const;

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

/**
 * The armor amount, when given and positive, folded into the reason text the way BE's own `/wound`
 * route expects - the bot states how the hit landed, never doing armor math of its own.
 */
export function foldArmorIntoReason(armor: number | null, reason: string): string {
	if (armor === null || armor <= 0) {
		return reason;
	}
	const armorLine = `${armor} to armor.`;
	return reason === '' ? armorLine : `${armorLine} ${reason}`;
}

/**
 * The full wound-state reply, one line per type.
 */
export function formatWoundReply(locale: Locale, wounds: Wounds): string {
	return t(locale, 'wound.result', { bashing: wounds.bashing, lethal: wounds.lethal, aggravated: wounds.aggravated });
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

/**
 * Builds `/wound` or `/heal`: a player's own active (or named) character, or a Storyteller naming
 * any character in the chronicle - the same own-or-staff split `/sheet` already uses.
 */
export function createWoundHealCommand(options: {
	name: string;
	description: string;
	descriptionPtBr: string;
	kind: 'wound' | 'heal';
}): BotCommand {
	return {
		data: new SlashCommandBuilder()
			.setName(options.name)
			.setDescription(options.description)
			.setDescriptionLocalizations({ 'pt-BR': options.descriptionPtBr })
			.addStringOption((option) =>
				option
					.setName('type')
					.setDescription('bashing, lethal or aggravated')
					.setDescriptionLocalizations({ 'pt-BR': 'contundente, letal ou agravado' })
					.setRequired(true)
					.addChoices(
						{ name: 'Bashing', value: 'bashing', name_localizations: { 'pt-BR': 'Contundente' } },
						{ name: 'Lethal', value: 'lethal', name_localizations: { 'pt-BR': 'Letal' } },
						{ name: 'Aggravated', value: 'aggravated', name_localizations: { 'pt-BR': 'Agravado' } }
					)
			)
			.addIntegerOption((option) =>
				option
					.setName('amount')
					.setDescription('How many health levels')
					.setDescriptionLocalizations({ 'pt-BR': 'Quantos níveis de saúde' })
					.setRequired(true)
					.setMinValue(1)
			)
			.addStringOption((option) =>
				option
					.setName('character')
					.setDescription('The character (defaults to your active character)')
					.setDescriptionLocalizations({ 'pt-BR': 'O personagem (o padrão é seu personagem ativo)' })
					.setAutocomplete(true)
			)
			.addIntegerOption((option) =>
				option
					.setName('armor')
					.setDescription('Points the hit took off before it reached you - /wound only')
					.setDescriptionLocalizations({ 'pt-BR': 'Pontos que o golpe perdeu antes de te atingir - só no /wound' })
					.setMinValue(1)
			)
			.addStringOption((option) =>
				option
					.setName('reason')
					.setDescription('Why - shown on the chronicle site')
					.setDescriptionLocalizations({ 'pt-BR': 'Por quê - aparece no site da crônica' })
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

			const type = interaction.options.getString('type', true) as WoundType;
			if (!(WOUND_TYPES as readonly string[]).includes(type)) {
				return;
			}
			const amount = interaction.options.getInteger('amount', true);
			const characterOption = interaction.options.getString('character');
			const armor = options.kind === 'wound' ? interaction.options.getInteger('armor') : null;
			const reason = foldArmorIntoReason(armor, interaction.options.getString('reason') ?? '');

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
				const wounds =
					options.kind === 'wound'
						? await takeWound(connection, secret, interaction.user.id, characterId, type, amount, reason)
						: await healWound(connection, secret, interaction.user.id, characterId, type, amount);
				await interaction.editReply(formatWoundReply(locale, wounds));
			} catch (error) {
				if (error instanceof BeApiError && error.kind === 'user_not_linked') {
					await interaction.editReply(t(locale, 'shared.userNotLinked'));
					return;
				}
				if (error instanceof BeApiError && error.httpStatus === 403) {
					await interaction.editReply(t(locale, 'wound.onlyOwnOrStaff'));
					return;
				}
				if (error instanceof BeApiError && error.httpStatus === 404) {
					await interaction.editReply(t(locale, 'sheet.characterNotFound'));
					return;
				}
				context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, `/${options.name} failed`);
				await interaction.editReply(t(locale, 'shared.unreachable'));
			}
		},
	};
}
