import { SlashCommandBuilder, MessageFlags, ChannelType, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { fetchMyPlots, postScene } from '../be/gameNight.js';
import { findProxiedMessage } from '../posting/store.js';
import { fetchPostingProfile } from '../be/postingProfile.js';
import type { Connection } from '../be/temporaryState.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

export interface SceneLine {
	speaker: string;
	content: string;
	inCharacter: boolean;
}

/**
 * One rendered line per message with real text, oldest first - a proxied message credits its
 * character, anything else credits the Discord member and is marked out of character.
 */
export function formatSceneLines(lines: SceneLine[]): string {
	return lines.map((line) => (line.inCharacter ? `${line.speaker}: ${line.content}` : `${line.speaker} (OOC): ${line.content}`)).join('\n');
}

export const sceneCommand: BotCommand = {
	data: new SlashCommandBuilder()
		.setName('scene')
		.setDescription("Save this channel's recent posts as a scene on a plot")
		.setDescriptionLocalizations({ 'pt-BR': 'Salva as mensagens recentes deste canal como uma cena em um plot' })
		.addStringOption((option) =>
			option
				.setName('plot')
				.setDescription('The plot to save this scene to')
				.setDescriptionLocalizations({ 'pt-BR': 'O plot onde salvar esta cena' })
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addIntegerOption((option) =>
			option
				.setName('messages')
				.setDescription(`How many recent messages (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`)
				.setDescriptionLocalizations({ 'pt-BR': `Quantas mensagens recentes (padrão ${DEFAULT_LIMIT}, máximo ${MAX_LIMIT})` })
				.setMinValue(1)
				.setMaxValue(MAX_LIMIT)
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
		const focused = interaction.options.getFocused().toLowerCase();
		try {
			const plots = await fetchMyPlots(connection, secret, interaction.user.id);
			const matches = plots.filter((plot) => plot.title.toLowerCase().includes(focused)).slice(0, 25);
			await interaction.respond(matches.map((plot) => ({ name: plot.title, value: String(plot.id) })));
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
		const channel = interaction.channel;

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const secret = decrypt(connection.secret_enc, context.config.secretKey);

		const plotOption = interaction.options.getString('plot', true);
		const plotId = Number(plotOption);
		const limit = interaction.options.getInteger('messages') ?? DEFAULT_LIMIT;

		const plots = await fetchMyPlots(connection, secret, interaction.user.id);
		const plot = plots.find((candidate) => candidate.id === plotId);
		if (!plot) {
			await interaction.editReply(t(locale, 'scene.notAllowed'));
			return;
		}

		const fetched = await channel.messages.fetch({ limit });
		const ordered = [...fetched.values()].reverse();

		const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };
		const nameCache = new Map<number, string>();

		const lines: SceneLine[] = [];
		for (const message of ordered) {
			if (message.content === '') {
				continue;
			}
			const proxied = await findProxiedMessage(context.pool, guildId, message.id);
			if (proxied) {
				let name = nameCache.get(proxied.characterId);
				if (name === undefined) {
					try {
						const profile = await fetchPostingProfile(beConnection, secret, proxied.discordUserId, proxied.characterId);
						name = profile.display_name;
					} catch {
						name = `#${proxied.characterId}`;
					}
					nameCache.set(proxied.characterId, name);
				}
				lines.push({ speaker: name, content: message.content, inCharacter: true });
			} else {
				lines.push({ speaker: message.member?.displayName ?? message.author.username, content: message.content, inCharacter: false });
			}
		}

		if (lines.length === 0) {
			await interaction.editReply(t(locale, 'scene.noMessages'));
			return;
		}

		try {
			await postScene(connection, secret, interaction.user.id, plotId, formatSceneLines(lines));
			await interaction.editReply(t(locale, 'scene.success', { title: plot.title, count: lines.length }));
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			if (error instanceof BeApiError && (error.httpStatus === 404 || error.httpStatus === 403)) {
				await interaction.editReply(t(locale, 'scene.notAllowed'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/scene failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
		}
	},
};
