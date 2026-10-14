import {
	SlashCommandBuilder,
	MessageFlags,
	type ChatInputCommandInteraction,
	type AutocompleteInteraction,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';

export interface LinkedCharacter {
	id: number;
	name: string;
}

interface LookupResponse {
	status: string;
	characters: LinkedCharacter[];
}

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

export type ActiveCharacterStatus =
	| { kind: 'none' }
	| { kind: 'cleared' }
	| { kind: 'active'; character: LinkedCharacter };

/**
 * Up to 25 of a player's linked characters whose name contains the autocomplete query, case-insensitive.
 */
export function matchingCharacters(characters: LinkedCharacter[], query: string): LinkedCharacter[] {
	const lowered = query.toLowerCase();
	return characters.filter((character) => character.name.toLowerCase().includes(lowered)).slice(0, 25);
}

/**
 * Whether the stored active character is still one of the player's current links - `none` when
 * nothing is set, `cleared` when it dropped out of the linked list since it was chosen.
 */
export function resolveActiveCharacter(characters: LinkedCharacter[], activeId: number | null): ActiveCharacterStatus {
	if (activeId === null) {
		return { kind: 'none' };
	}
	const character = characters.find((candidate) => candidate.id === activeId);
	return character ? { kind: 'active', character } : { kind: 'cleared' };
}

async function fetchLinkedCharacters(connection: ConnectionRow, secret: Buffer, discordUserId: string): Promise<LookupResponse> {
	return callBe<LookupResponse>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/bot/links/${discordUserId}`,
		signedAs: { connectionId: String(connection.be_connection_id), secret },
	});
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

export const characterCommand = {
	data: new SlashCommandBuilder()
		.setName('character')
		.setDescription('Show or change your active character')
		.setDescriptionLocalizations({ 'pt-BR': 'Mostra ou troca seu personagem ativo' })
		.addStringOption((option) =>
			option
				.setName('name')
				.setDescription('The character to make active')
				.setDescriptionLocalizations({ 'pt-BR': 'O personagem para tornar ativo' })
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
			const result = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			const matches = matchingCharacters(result.characters, interaction.options.getFocused());
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

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.editReply(t(locale, 'disconnect.notConnected'));
			return;
		}

		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		let lookup: LookupResponse;
		try {
			lookup = await fetchLinkedCharacters(connection, secret, interaction.user.id);
		} catch (error) {
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/character lookup failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}

		if (lookup.characters.length === 0) {
			await interaction.editReply(t(locale, 'shared.userNotLinked'));
			return;
		}

		const chosenId = interaction.options.getString('name');
		if (chosenId !== null) {
			const character = lookup.characters.find((candidate) => String(candidate.id) === chosenId);
			if (!character) {
				await interaction.editReply(t(locale, 'character.invalidSelection'));
				return;
			}
			await context.pool.query(
				`INSERT INTO user_prefs (guild_id, discord_user_id, active_character_id)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET active_character_id = $3`,
				[guildId, interaction.user.id, character.id]
			);
			await interaction.editReply(t(locale, 'character.setActive', { name: character.name }));
			return;
		}

		const prefs = await context.pool.query<{ active_character_id: number | null }>(
			'SELECT active_character_id FROM user_prefs WHERE guild_id = $1 AND discord_user_id = $2',
			[guildId, interaction.user.id]
		);
		const status = resolveActiveCharacter(lookup.characters, prefs.rows[0]?.active_character_id ?? null);

		if (status.kind === 'none') {
			await interaction.editReply(t(locale, 'character.noneActive'));
			return;
		}
		if (status.kind === 'cleared') {
			await context.pool.query(
				'UPDATE user_prefs SET active_character_id = NULL WHERE guild_id = $1 AND discord_user_id = $2',
				[guildId, interaction.user.id]
			);
			await interaction.editReply(t(locale, 'character.activeCleared'));
			return;
		}
		await interaction.editReply(t(locale, 'character.active', { name: status.character.name }));
	},
};
