import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { fetchMyPlots, downtimePlots, postAction } from '../be/gameNight.js';

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

async function listDowntime(
	interaction: ChatInputCommandInteraction,
	context: CommandContext,
	connection: ConnectionRow,
	secret: Buffer
): Promise<void> {
	const locale = resolveLocale(interaction.locale);
	const plots = downtimePlots(await fetchMyPlots(connection, secret, interaction.user.id));

	if (plots.length === 0) {
		await interaction.editReply(t(locale, 'downtime.listNone'));
		return;
	}

	const lines = plots.map((plot) => `• ${plot.title}${plot.game_date ? ` (${plot.game_date})` : ''}`);
	await interaction.editReply(`${t(locale, 'downtime.listHeader')}\n${lines.join('\n')}`);
}

async function postDowntime(
	interaction: ChatInputCommandInteraction,
	context: CommandContext,
	connection: ConnectionRow,
	secret: Buffer
): Promise<void> {
	const locale = resolveLocale(interaction.locale);
	const plotOption = interaction.options.getString('plot');
	const content = interaction.options.getString('action', true);

	if (plotOption === null) {
		await interaction.editReply(t(locale, 'downtime.noPlot'));
		return;
	}
	const plotId = Number(plotOption);

	const plots = downtimePlots(await fetchMyPlots(connection, secret, interaction.user.id));
	const plot = plots.find((candidate) => candidate.id === plotId);
	if (!plot) {
		await interaction.editReply(t(locale, 'downtime.notYours'));
		return;
	}

	try {
		await postAction(connection, secret, interaction.user.id, plotId, content);
		await interaction.editReply(t(locale, 'downtime.success', { title: plot.title }));
	} catch (error) {
		if (error instanceof BeApiError && error.kind === 'user_not_linked') {
			await interaction.editReply(t(locale, 'shared.userNotLinked'));
			return;
		}
		if (error instanceof BeApiError && error.beCode === 'downtime_not_open') {
			await interaction.editReply(t(locale, 'downtime.windowNotOpen'));
			return;
		}
		if (error instanceof BeApiError && (error.httpStatus === 404 || error.httpStatus === 403)) {
			await interaction.editReply(t(locale, 'downtime.notYours'));
			return;
		}
		context.logger.warn(
			{ guildId: interaction.guildId, error: error instanceof Error ? error.message : String(error) },
			'/downtime post failed'
		);
		await interaction.editReply(t(locale, 'shared.unreachable'));
	}
}

export const downtimeCommand: BotCommand = {
	data: new SlashCommandBuilder()
		.setName('downtime')
		.setDescription('List your downtime plots, or post an action to one')
		.setDescriptionLocalizations({ 'pt-BR': 'Lista seus plots de downtime, ou posta uma ação em um deles' })
		.addSubcommand((sub) =>
			sub
				.setName('list')
				.setDescription('List your downtime plots')
				.setDescriptionLocalizations({ 'pt-BR': 'Lista seus plots de downtime' })
		)
		.addSubcommand((sub) =>
			sub
				.setName('post')
				.setDescription('Post an action to one of your downtime plots')
				.setDescriptionLocalizations({ 'pt-BR': 'Posta uma ação em um dos seus plots de downtime' })
				.addStringOption((option) =>
					option
						.setName('plot')
						.setDescription('The downtime plot')
						.setDescriptionLocalizations({ 'pt-BR': 'O plot de downtime' })
						.setRequired(true)
						.setAutocomplete(true)
				)
				.addStringOption((option) =>
					option
						.setName('action')
						.setDescription('What your character does')
						.setDescriptionLocalizations({ 'pt-BR': 'O que seu personagem faz' })
						.setRequired(true)
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
		const focused = interaction.options.getFocused().toLowerCase();
		try {
			const plots = downtimePlots(await fetchMyPlots(connection, secret, interaction.user.id));
			const matches = plots.filter((plot) => plot.title.toLowerCase().includes(focused)).slice(0, 25);
			await interaction.respond(matches.map((plot) => ({ name: plot.title, value: String(plot.id) })));
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
		const secret = decrypt(connection.secret_enc, context.config.secretKey);

		try {
			if (interaction.options.getSubcommand() === 'list') {
				await listDowntime(interaction, context, connection, secret);
				return;
			}
			await postDowntime(interaction, context, connection, secret);
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/downtime failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
		}
	},
};
