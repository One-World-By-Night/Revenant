import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { t, resolveLocale } from '../i18n/index.js';
import { setTrigger, clearTrigger } from '../posting/store.js';

const MAX_TRIGGER_LENGTH = 10;

export const triggerCommand = {
	data: new SlashCommandBuilder()
		.setName('trigger')
		.setDescription('Manage your own posting trigger')
		.setDescriptionLocalizations({ 'pt-BR': 'Gerencia seu próprio gatilho de postagem' })
		.addSubcommand((sub) =>
			sub
				.setName('set')
				.setDescription('Set your trigger')
				.setDescriptionLocalizations({ 'pt-BR': 'Define seu gatilho' })
				.addStringOption((option) =>
					option
						.setName('text')
						.setDescription('e.g. k: or [[')
						.setDescriptionLocalizations({ 'pt-BR': 'ex: k: ou [[' })
						.setRequired(true)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName('clear')
				.setDescription('Clear your trigger')
				.setDescriptionLocalizations({ 'pt-BR': 'Remove seu gatilho' })
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;
		const subcommand = interaction.options.getSubcommand(true);

		if (subcommand === 'clear') {
			await clearTrigger(context.pool, guildId, interaction.user.id);
			await interaction.reply({ content: t(locale, 'trigger.cleared'), flags: MessageFlags.Ephemeral });
			return;
		}

		const text = interaction.options.getString('text', true).trim();
		if (text.length === 0 || text.length > MAX_TRIGGER_LENGTH) {
			await interaction.reply({ content: t(locale, 'trigger.invalid'), flags: MessageFlags.Ephemeral });
			return;
		}

		await setTrigger(context.pool, guildId, interaction.user.id, text);
		await interaction.reply({ content: t(locale, 'trigger.set', { text }), flags: MessageFlags.Ephemeral });
	},
};
