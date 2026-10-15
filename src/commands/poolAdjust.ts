import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { activeCharacterId, matchingCharacters, type LinkedCharacter } from './character.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale, type Locale } from '../i18n/index.js';
import { discoverPools, fetchCharacterRaw, adjustPool, wasClamped, type DiscoveredPool, type PoolAdjustResult } from '../be/temporaryState.js';
import { resolvePoolSelection, matchingPools, poolOptionValue } from '../lib/poolSelection.js';

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

interface LookupResponse {
	characters: LinkedCharacter[];
}

/**
 * The reply for a successful spend or regain: the pool's new temporary rating over its permanent
 * one, with a note when BE's own `[0, permanent]` clamp kept it from moving the full amount.
 */
export function formatPoolReply(locale: Locale, poolName: string, before: number, result: PoolAdjustResult, delta: number): string {
	const base = t(locale, 'pool.result', { pool: poolName, temporary: result.temporary, permanent: result.permanent });
	return wasClamped(before, delta, result.temporary) ? base + t(locale, 'pool.clampedNote', { pool: poolName }) : base;
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

async function resolveCharacterId(
	context: CommandContext,
	interaction: ChatInputCommandInteraction | AutocompleteInteraction,
	characterOption: string | null
): Promise<number | null> {
	if (characterOption !== null) {
		return Number(characterOption);
	}
	return activeCharacterId(context, interaction);
}

async function poolsForCharacter(connection: ConnectionRow, secret: Buffer, discordUserId: string, characterId: number): Promise<DiscoveredPool[]> {
	const character = await fetchCharacterRaw(connection, secret, discordUserId, characterId);
	return discoverPools(character.sheet_data);
}

/**
 * Builds `/spend` or `/regain`: identical in every way except the sign the amount is applied with,
 * the command's own name and description, and its default reason.
 */
export function createPoolAdjustCommand(options: {
	name: string;
	description: string;
	descriptionPtBr: string;
	sign: 1 | -1;
	defaultReason: string;
}): BotCommand {
	return {
		data: new SlashCommandBuilder()
			.setName(options.name)
			.setDescription(options.description)
			.setDescriptionLocalizations({ 'pt-BR': options.descriptionPtBr })
			.addStringOption((option) =>
				option
					.setName('pool')
					.setDescription('Which pool - leave out when your character holds only one')
					.setDescriptionLocalizations({ 'pt-BR': 'Qual reserva - deixe vazio se seu personagem só tem uma' })
					.setAutocomplete(true)
			)
			.addIntegerOption((option) =>
				option
					.setName('amount')
					.setDescription('How many points (default 1)')
					.setDescriptionLocalizations({ 'pt-BR': 'Quantos pontos (padrão 1)' })
					.setMinValue(1)
			)
			.addStringOption((option) =>
				option
					.setName('character')
					.setDescription('The character (defaults to your active character)')
					.setDescriptionLocalizations({ 'pt-BR': 'O personagem (o padrão é seu personagem ativo)' })
					.setAutocomplete(true)
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
			const focused = interaction.options.getFocused(true);

			try {
				if (focused.name === 'character') {
					const lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
					const matches = matchingCharacters(lookup.characters, focused.value);
					await interaction.respond(matches.map((character) => ({ name: character.name, value: String(character.id) })));
					return;
				}

				if (focused.name === 'pool') {
					const characterOption = interaction.options.getString('character');
					const characterId = await resolveCharacterId(context, interaction, characterOption);
					if (characterId === null) {
						await interaction.respond([]);
						return;
					}
					const pools = await poolsForCharacter(connection, secret, interaction.user.id, characterId);
					const matches = matchingPools(pools, focused.value);
					await interaction.respond(matches.map((pool) => ({ name: pool.poolName, value: poolOptionValue(pool) })));
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
			const poolOption = interaction.options.getString('pool');
			const amount = interaction.options.getInteger('amount') ?? 1;
			const reason = interaction.options.getString('reason') ?? options.defaultReason;

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const secret = decrypt(connection.secret_enc, context.config.secretKey);

			const characterId = await resolveCharacterId(context, interaction, characterOption);
			if (characterId === null) {
				await interaction.editReply(t(locale, 'sheet.noCharacter'));
				return;
			}

			let lookup: LookupResponse;
			try {
				lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			} catch {
				lookup = { characters: [] };
			}
			if (!lookup.characters.some((character) => character.id === characterId)) {
				await interaction.editReply(t(locale, 'pool.onlyOwnCharacter'));
				return;
			}
			const characterName = lookup.characters.find((character) => character.id === characterId)?.name ?? '';

			let pools: DiscoveredPool[];
			try {
				pools = await poolsForCharacter(connection, secret, interaction.user.id, characterId);
			} catch (error) {
				if (error instanceof BeApiError && error.kind === 'user_not_linked') {
					await interaction.editReply(t(locale, 'shared.userNotLinked'));
					return;
				}
				context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, `/${options.name} failed`);
				await interaction.editReply(t(locale, 'shared.unreachable'));
				return;
			}

			const selection = resolvePoolSelection(pools, poolOption);
			if (selection.kind === 'none') {
				await interaction.editReply(t(locale, 'pool.none', { character: characterName }));
				return;
			}
			if (selection.kind === 'notFound') {
				await interaction.editReply(t(locale, 'pool.notFound'));
				return;
			}
			if (selection.kind === 'ambiguous') {
				await interaction.editReply(
					t(locale, 'pool.ambiguous', { character: characterName, pools: selection.pools.map((pool) => pool.poolName).join(', ') })
				);
				return;
			}

			const { pool } = selection;
			const delta = options.sign * amount;

			try {
				const result = await adjustPool(connection, secret, interaction.user.id, characterId, pool.blockSlug, pool.poolName, delta, reason);
				await interaction.editReply(formatPoolReply(locale, pool.poolName, pool.temporary, result, delta));
			} catch (error) {
				context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, `/${options.name} failed`);
				await interaction.editReply(t(locale, 'shared.unreachable'));
			}
		},
	};
}
