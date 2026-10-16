import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { searchPlots, fetchPlotWithEntries } from '../be/gameNight.js';
import { buildPlotEmbed } from '../render/plot.js';

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

export const plotCommand: BotCommand = {
	data: new SlashCommandBuilder()
		.setName('plot')
		.setDescription('Show a plot you can see, with its most recent entries')
		.setDescriptionLocalizations({ 'pt-BR': 'Mostra um plot que você pode ver, com suas entradas mais recentes' })
		.addStringOption((option) =>
			option
				.setName('name')
				.setDescription('The plot')
				.setDescriptionLocalizations({ 'pt-BR': 'O plot' })
				.setRequired(true)
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
			const plots = await searchPlots(connection, secret, interaction.user.id, interaction.options.getFocused());
			await interaction.respond(plots.map((plot) => ({ name: plot.title, value: String(plot.id) })));
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

		const plotOption = interaction.options.getString('name', true);
		const plotId = Number(plotOption);
		if (!Number.isInteger(plotId)) {
			await interaction.editReply(t(locale, 'plot.noPlot'));
			return;
		}

		try {
			const plot = await fetchPlotWithEntries(connection, secret, interaction.user.id, plotId);
			await interaction.editReply({ embeds: [buildPlotEmbed(locale, plot)] });
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			if (error instanceof BeApiError && error.httpStatus === 404) {
				await interaction.editReply(t(locale, 'plot.notFound'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/plot failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
		}
	},
};
