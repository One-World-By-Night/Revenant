import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { runChallengeFlow } from './challenge.js';
import type { Category } from '../challenges/engine.js';

export const staticCommand = {
	data: new SlashCommandBuilder()
		.setName('static')
		.setDescription('A challenge against a difficulty count claimed by a Narrator or Storyteller')
		.setDescriptionLocalizations({ 'pt-BR': 'Um desafio contra uma contagem de dificuldade declarada por um Narrador ou Storyteller' })
		.addUserOption((option) =>
			option
				.setName('narrator')
				.setDescription('The Narrator or Storyteller claiming the difficulty count')
				.setDescriptionLocalizations({ 'pt-BR': 'O Narrador ou Storyteller que declara a contagem de dificuldade' })
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('category')
				.setDescription('Physical, Social or Mental')
				.setDescriptionLocalizations({ 'pt-BR': 'Físico, Social ou Mental' })
				.setRequired(true)
				.addChoices(
					{ name: 'Physical', value: 'physical', name_localizations: { 'pt-BR': 'Físico' } },
					{ name: 'Social', value: 'social', name_localizations: { 'pt-BR': 'Social' } },
					{ name: 'Mental', value: 'mental', name_localizations: { 'pt-BR': 'Mental' } }
				)
		)
		.addStringOption((option) =>
			option
				.setName('conditions')
				.setDescription('What is physically happening - "I pick the lock"')
				.setDescriptionLocalizations({ 'pt-BR': 'O que está acontecendo - "Eu arrombo a fechadura"' })
				.setRequired(true)
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		await runChallengeFlow(interaction, context, {
			opponentUser: interaction.options.getUser('narrator', true),
			category: interaction.options.getString('category', true) as Category,
			conditions: interaction.options.getString('conditions', true),
			kind: 'static',
			requireDefenderCharacter: false,
		});
	},
};
