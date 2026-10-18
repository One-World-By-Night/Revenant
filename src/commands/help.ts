import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { t, resolveLocale, type Locale } from '../i18n/index.js';

export type HelpTopic = 'connect' | 'characters' | 'temporary' | 'challenges' | 'posting' | 'gamenight' | 'rooms' | 'dice';

export const HELP_TOPICS: HelpTopic[] = ['connect', 'characters', 'temporary', 'challenges', 'posting', 'gamenight', 'rooms', 'dice'];

/**
 * Builds the overview reply: one line per topic, naming its own commands.
 */
export function renderHelpOverview(locale: Locale): string {
	const lines = HELP_TOPICS.map((topic) => t(locale, `help.overview.${topic}`));
	return `${t(locale, 'help.overview.heading')}\n\n${lines.join('\n')}\n\n${t(locale, 'help.overview.footer')}`;
}

/**
 * Builds one topic's detail reply.
 */
export function renderHelpTopic(locale: Locale, topic: HelpTopic): string {
	return t(locale, `help.topic.${topic}`);
}

export const helpCommand = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('See what Revenant can do')
		.setDescriptionLocalizations({ 'pt-BR': 'Veja o que o Revenant pode fazer' })
		.addStringOption((option) =>
			option
				.setName('topic')
				.setDescription('One area to see in detail')
				.setDescriptionLocalizations({ 'pt-BR': 'Uma área para ver em detalhe' })
				.addChoices(
					{ name: 'Connecting and linking', value: 'connect', name_localizations: { 'pt-BR': 'Conectar e vincular' } },
					{ name: 'Characters and sheets', value: 'characters', name_localizations: { 'pt-BR': 'Personagens e fichas' } },
					{ name: 'Temporary state (pools, wounds)', value: 'temporary', name_localizations: { 'pt-BR': 'Estado temporário (reservas, feridas)' } },
					{ name: 'Challenges', value: 'challenges', name_localizations: { 'pt-BR': 'Desafios' } },
					{ name: 'In-character posting', value: 'posting', name_localizations: { 'pt-BR': 'Postagem no personagem' } },
					{ name: 'Game night', value: 'gamenight', name_localizations: { 'pt-BR': 'Noite de jogo' } },
					{ name: 'Player rooms', value: 'rooms', name_localizations: { 'pt-BR': 'Salas de jogador' } },
					{ name: 'Dice', value: 'dice', name_localizations: { 'pt-BR': 'Dados' } }
				)
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, _context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		const topic = interaction.options.getString('topic') as HelpTopic | null;
		const content = topic ? renderHelpTopic(locale, topic) : renderHelpOverview(locale);
		await interaction.reply({ content, flags: MessageFlags.Ephemeral });
	},
};
