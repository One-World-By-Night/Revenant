import {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	MessageFlags,
	type ChatInputCommandInteraction,
	type AutocompleteInteraction,
	type APIEmbed,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale, type Locale } from '../i18n/index.js';
import { buildSheetEmbeds, buildSingleSectionEmbed, paginateEmbeds, type SheetDocument } from '../render/sheet.js';
import { matchingCharacters, type LinkedCharacter } from './character.js';
import { createTtlCache } from '../lib/ttlCache.js';

const PAGER_TIMEOUT_MS = 5 * 60 * 1000;
const SECTION_CACHE_TTL_MS = 60_000;
const sectionTitleCache = createTtlCache<string[]>(SECTION_CACHE_TTL_MS);

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
	game_name: string;
}

interface LookupResponse {
	status: string;
	staff: boolean;
	characters: LinkedCharacter[];
}

interface SearchedCharacter {
	id: number;
	name: string;
}

/**
 * Whether a character id is one of the player's own linked characters.
 */
export function isLinkedCharacter(characters: LinkedCharacter[], characterId: number): boolean {
	return characters.some((character) => character.id === characterId);
}

/**
 * Clamps a page index move to stay within `[0, pageCount - 1]`.
 */
export function clampPageIndex(current: number, delta: number, pageCount: number): number {
	return Math.min(Math.max(current + delta, 0), Math.max(pageCount - 1, 0));
}

function pagerRow(locale: Locale, pageIndex: number, pageCount: number): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('sheet:prev')
			.setLabel(t(locale, 'sheet.previousButton'))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(pageIndex === 0),
		new ButtonBuilder()
			.setCustomId('sheet:next')
			.setLabel(t(locale, 'sheet.nextButton'))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(pageIndex >= pageCount - 1)
	);
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug, game_name FROM connections WHERE guild_id = $1',
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

async function fetchSheetDocument(
	connection: ConnectionRow,
	secret: Buffer,
	discordUserId: string,
	characterId: number
): Promise<SheetDocument | null> {
	return callBe<SheetDocument | null>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/characters/${characterId}/sheet-document`,
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

export const sheetCommand = {
	data: new SlashCommandBuilder()
		.setName('sheet')
		.setDescription("Show a character's sheet")
		.setDescriptionLocalizations({ 'pt-BR': 'Mostra a ficha de um personagem' })
		.addStringOption((option) =>
			option
				.setName('character')
				.setDescription('The character to show (defaults to your active character)')
				.setDescriptionLocalizations({ 'pt-BR': 'O personagem a mostrar (o padrão é seu personagem ativo)' })
				.setAutocomplete(true)
		)
		.addStringOption((option) =>
			option
				.setName('section')
				.setDescription('Show only this section')
				.setDescriptionLocalizations({ 'pt-BR': 'Mostra só esta seção' })
				.setAutocomplete(true)
		)
		.addBooleanOption((option) =>
			option
				.setName('public')
				.setDescription('Post in the channel instead of privately')
				.setDescriptionLocalizations({ 'pt-BR': 'Publica no canal em vez de só para você' })
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
		const focused = interaction.options.getFocused(true);

		try {
			if (focused.name === 'character') {
				const lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
				if (lookup.staff) {
					const found = await searchCharacters(connection, secret, interaction.user.id, focused.value);
					await interaction.respond(found.map((character) => ({ name: character.name, value: String(character.id) })));
					return;
				}
				const matches = matchingCharacters(lookup.characters, focused.value);
				await interaction.respond(matches.map((character) => ({ name: character.name, value: String(character.id) })));
				return;
			}

			if (focused.name === 'section') {
				const characterOption = interaction.options.getString('character');
				const characterId = characterOption !== null ? Number(characterOption) : await activeCharacterId(context, interaction);
				if (characterId === null) {
					await interaction.respond([]);
					return;
				}
				const titles = await sectionTitles(connection, secret, interaction.user.id, characterId);
				const lowered = focused.value.toLowerCase();
				const matches = titles.filter((title) => title.toLowerCase().includes(lowered)).slice(0, 25);
				await interaction.respond(matches.map((title) => ({ name: title, value: title })));
				return;
			}

			await interaction.respond([]);
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
		const sectionOption = interaction.options.getString('section');
		const publicRequested = interaction.options.getBoolean('public') ?? false;

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

		let isOwn = false;
		try {
			const lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			isOwn = isLinkedCharacter(lookup.characters, characterId);
		} catch {
			isOwn = false;
		}

		if (publicRequested && !isOwn) {
			await interaction.editReply(t(locale, 'sheet.publicOwnOnly'));
			return;
		}

		let doc: SheetDocument | null;
		try {
			doc = await fetchSheetDocument(connection, secret, interaction.user.id, characterId);
		} catch (error) {
			if (error instanceof BeApiError && error.httpStatus === 403) {
				await interaction.editReply(t(locale, 'sheet.forbidden'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 404) {
				await interaction.editReply(t(locale, 'sheet.characterNotFound'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/sheet failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}
		if (doc === null) {
			await interaction.editReply(t(locale, 'sheet.characterNotFound'));
			return;
		}

		let embeds: APIEmbed[];
		if (sectionOption !== null) {
			const embed = buildSingleSectionEmbed(doc, sectionOption, null);
			if (!embed) {
				await interaction.editReply(t(locale, 'sheet.sectionNotFound'));
				return;
			}
			embeds = [embed];
		} else {
			embeds = buildSheetEmbeds(doc, { accentColor: null, footerText: connection.game_name });
		}

		const pages = paginateEmbeds(embeds);
		const firstPage = pages[0] ?? [];
		const components = pages.length > 1 ? [pagerRow(locale, 0, pages.length)] : [];

		const message = publicRequested
			? await (async () => {
					await interaction.editReply(t(locale, 'sheet.postedPublicly'));
					return interaction.followUp({ embeds: firstPage, components, fetchReply: true });
				})()
			: await interaction.editReply({ embeds: firstPage, components });

		if (pages.length <= 1) {
			return;
		}

		let pageIndex = 0;
		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === interaction.user.id,
			time: PAGER_TIMEOUT_MS,
		});

		collector.on('collect', (buttonInteraction) => {
			const delta = buttonInteraction.customId === 'sheet:next' ? 1 : -1;
			pageIndex = clampPageIndex(pageIndex, delta, pages.length);
			void buttonInteraction.update({ embeds: pages[pageIndex] ?? [], components: [pagerRow(locale, pageIndex, pages.length)] });
		});

		collector.on('end', () => {
			message.edit({ components: [] }).catch(() => undefined);
		});
	},
};

async function activeCharacterId(context: CommandContext, interaction: ChatInputCommandInteraction | AutocompleteInteraction): Promise<number | null> {
	if (!interaction.guildId) {
		return null;
	}
	const prefs = await context.pool.query<{ active_character_id: number | null }>(
		'SELECT active_character_id FROM user_prefs WHERE guild_id = $1 AND discord_user_id = $2',
		[interaction.guildId, interaction.user.id]
	);
	return prefs.rows[0]?.active_character_id ?? null;
}

async function sectionTitles(connection: ConnectionRow, secret: Buffer, discordUserId: string, characterId: number): Promise<string[]> {
	const cacheKey = `${discordUserId}:${characterId}`;
	const cached = sectionTitleCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const doc = await fetchSheetDocument(connection, secret, discordUserId, characterId);
	const titles = doc ? doc.sections.map((section) => section.title) : [];
	sectionTitleCache.set(cacheKey, titles);
	return titles;
}
