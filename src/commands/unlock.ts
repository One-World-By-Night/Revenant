import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { t, resolveLocale } from '../i18n/index.js';
import { clearLock } from '../posting/store.js';

export const unlockCommand = {
	data: new SlashCommandBuilder()
		.setName('unlock')
		.setDescription('Stop posting every message as a locked character')
		.setDescriptionLocalizations({ 'pt-BR': 'Para de postar toda mensagem como um personagem travado' }) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		await clearLock(context.pool, interaction.guildId, interaction.user.id);
		await interaction.reply({ content: t(locale, 'unlock.done'), flags: MessageFlags.Ephemeral });
	},
};
