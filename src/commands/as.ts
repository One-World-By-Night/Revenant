import {
	SlashCommandBuilder,
	MessageFlags,
	ChannelType,
	type ChatInputCommandInteraction,
	type AutocompleteInteraction,
	type TextChannel,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { fetchPostingProfile } from '../be/postingProfile.js';
import { postAsCharacter } from '../discord/webhooks.js';
import { recordProxiedMessage, setLock } from '../posting/store.js';
import type { Connection } from '../be/temporaryState.js';

interface LinkedCharacter {
	id: number;
	name: string;
}

interface LookupResponse {
	characters: LinkedCharacter[];
}

export interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

export async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

async function fetchLinkedCharacters(connection: ConnectionRow, secret: Buffer, discordUserId: string): Promise<LinkedCharacter[]> {
	const result = await callBe<LookupResponse>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/bot/links/${discordUserId}`,
		signedAs: { connectionId: String(connection.be_connection_id), secret },
	});
	return result.characters;
}

export function matchingLinkedCharacters(characters: LinkedCharacter[], query: string): LinkedCharacter[] {
	const lowered = query.toLowerCase();
	return characters.filter((character) => character.name.toLowerCase().includes(lowered)).slice(0, 25);
}

export const asCommand = {
	data: new SlashCommandBuilder()
		.setName('as')
		.setDescription('Post as one of your linked characters')
		.setDescriptionLocalizations({ 'pt-BR': 'Publica como um dos seus personagens vinculados' })
		.addStringOption((option) =>
			option
				.setName('character')
				.setDescription('The character to post as')
				.setDescriptionLocalizations({ 'pt-BR': 'O personagem para postar como' })
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addStringOption((option) =>
			option
				.setName('message')
				.setDescription('The message to post')
				.setDescriptionLocalizations({ 'pt-BR': 'A mensagem para publicar' })
		)
		.addStringOption((option) =>
			option
				.setName('lock')
				.setDescription('Post every message as this character until /unlock')
				.setDescriptionLocalizations({ 'pt-BR': 'Publica toda mensagem como este personagem até /unlock' })
				.addChoices(
					{ name: 'This channel', value: 'channel', name_localizations: { 'pt-BR': 'Este canal' } },
					{ name: 'The whole server', value: 'server', name_localizations: { 'pt-BR': 'O servidor todo' } }
				)
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
			const characters = await fetchLinkedCharacters(connection, secret, interaction.user.id);
			const matches = matchingLinkedCharacters(characters, interaction.options.getFocused());
			await interaction.respond(matches.map((character) => ({ name: character.name, value: String(character.id) })));
		} catch {
			await interaction.respond([]);
		}
	},

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
			await interaction.reply({ content: t(locale, 'as.wrongChannel'), flags: MessageFlags.Ephemeral });
			return;
		}
		const guildId = interaction.guildId;

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}

		const characterId = Number(interaction.options.getString('character', true));
		const message = interaction.options.getString('message');
		const lockScope = interaction.options.getString('lock') as 'channel' | 'server' | null;

		if (!message && !lockScope) {
			await interaction.reply({ content: t(locale, 'as.nothingToDo'), flags: MessageFlags.Ephemeral });
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };

		let profile;
		try {
			profile = await fetchPostingProfile(beConnection, secret, interaction.user.id, characterId);
		} catch {
			await interaction.editReply(t(locale, 'as.cannotPostAsThat'));
			return;
		}

		const channel = interaction.channel as TextChannel;
		const lines: string[] = [];

		if (message) {
			const messageId = await postAsCharacter(channel, context.pool, context.config.secretKey, guildId, profile, message);
			await recordProxiedMessage(context.pool, guildId, messageId, channel.id, interaction.user.id, characterId);
			lines.push(t(locale, 'as.posted', { name: profile.display_name }));
		}

		if (lockScope === 'channel') {
			await setLock(context.pool, guildId, interaction.user.id, channel.id, characterId);
			lines.push(t(locale, 'as.lockedChannel', { name: profile.display_name }));
		} else if (lockScope === 'server') {
			await setLock(context.pool, guildId, interaction.user.id, null, characterId);
			lines.push(t(locale, 'as.lockedServer', { name: profile.display_name }));
		}

		await interaction.editReply(lines.join('\n'));
	},
};
