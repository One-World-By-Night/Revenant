import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { parseNotation } from '../dice/notation.js';
import { rollNotation } from '../dice/roll.js';
import { createRng } from '../dice/rng.js';
import { validatePool, rollPool, DEFAULT_DIFFICULTY, type PoolRules } from '../dice/pools.js';
import { formatNotationResult, formatPoolResult } from '../dice/format.js';
import { callBe } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';

export type RollRequestKind = 'dice' | 'pool' | 'neither' | 'both';

/**
 * Decides which form of `/roll` was asked for from its two mutually exclusive options.
 */
export function classifyRollRequest(diceOption: string | null, poolOption: number | null): RollRequestKind {
	if (diceOption !== null && poolOption !== null) {
		return 'both';
	}
	if (diceOption !== null) {
		return 'dice';
	}
	if (poolOption !== null) {
		return 'pool';
	}
	return 'neither';
}

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

async function activeCharacterName(context: CommandContext, guildId: string, discordUserId: string): Promise<string | null> {
	const prefs = await context.pool.query<{ active_character_id: number | null }>(
		'SELECT active_character_id FROM user_prefs WHERE guild_id = $1 AND discord_user_id = $2',
		[guildId, discordUserId]
	);
	const activeId = prefs.rows[0]?.active_character_id;
	if (!activeId) {
		return null;
	}

	const connectionRows = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	const connection = connectionRows.rows[0];
	if (!connection) {
		return null;
	}

	try {
		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const lookup = await callBe<{ characters: Array<{ id: number; name: string }> }>(connection.rest_root, {
			method: 'GET',
			route: `/be/v1/${connection.game_slug}/bot/links/${discordUserId}`,
			signedAs: { connectionId: String(connection.be_connection_id), secret },
		});
		return lookup.characters.find((character) => character.id === activeId)?.name ?? null;
	} catch {
		return null;
	}
}

export const rollCommand = {
	data: new SlashCommandBuilder()
		.setName('roll')
		.setDescription('Roll dice')
		.setDescriptionLocalizations({ 'pt-BR': 'Rola dados' })
		.addStringOption((option) =>
			option
				.setName('dice')
				.setDescription('General dice notation, like 2d6+3')
				.setDescriptionLocalizations({ 'pt-BR': 'Notação geral de dados, como 2d6+3' })
		)
		.addIntegerOption((option) =>
			option
				.setName('pool')
				.setDescription('A World of Darkness dice pool size')
				.setDescriptionLocalizations({ 'pt-BR': 'O tamanho de uma reserva de dados' })
				.setMinValue(1)
				.setMaxValue(30)
		)
		.addIntegerOption((option) =>
			option
				.setName('difficulty')
				.setDescription('The pool difficulty (default 6)')
				.setDescriptionLocalizations({ 'pt-BR': 'A dificuldade da reserva (padrão 6)' })
				.setMinValue(2)
				.setMaxValue(10)
		)
		.addBooleanOption((option) =>
			option
				.setName('specialty')
				.setDescription('Apply a specialty to the pool')
				.setDescriptionLocalizations({ 'pt-BR': 'Aplica uma especialidade à reserva' })
		)
		.addStringOption((option) =>
			option
				.setName('label')
				.setDescription('A label to show with the result')
				.setDescriptionLocalizations({ 'pt-BR': 'Um rótulo para mostrar com o resultado' })
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;

		const diceOption = interaction.options.getString('dice');
		const poolOption = interaction.options.getInteger('pool');
		const difficultyOption = interaction.options.getInteger('difficulty');
		const specialtyOption = interaction.options.getBoolean('specialty') ?? false;
		const label = interaction.options.getString('label');

		const kind = classifyRollRequest(diceOption, poolOption);
		if (kind === 'both') {
			await interaction.reply({ content: t(locale, 'roll.bothGiven'), ephemeral: true });
			return;
		}
		if (kind === 'neither') {
			await interaction.reply({ content: t(locale, 'roll.neitherGiven'), ephemeral: true });
			return;
		}

		let resultText: string;
		let expression: string;
		let logResult: unknown;

		if (kind === 'dice') {
			const parsed = parseNotation(diceOption as string);
			if (!parsed.ok) {
				await interaction.reply({ content: parsed.error, ephemeral: true });
				return;
			}
			const rolled = rollNotation(parsed.notation, createRng());
			resultText = formatNotationResult(rolled);
			expression = diceOption as string;
			logResult = rolled;
		} else {
			const difficulty = difficultyOption ?? DEFAULT_DIFFICULTY;
			const validation = validatePool(poolOption as number, difficulty);
			if (!validation.ok) {
				await interaction.reply({ content: validation.error, ephemeral: true });
				return;
			}
			const settings = await context.pool.query<{ pool_rules: PoolRules }>(
				'SELECT pool_rules FROM guild_settings WHERE guild_id = $1',
				[guildId]
			);
			const rules = settings.rows[0]?.pool_rules ?? 'revised';
			const rolled = rollPool(poolOption as number, difficulty, rules, specialtyOption, createRng());
			resultText = formatPoolResult(rolled);
			expression = `pool:${poolOption} difficulty:${difficulty}${specialtyOption ? ' specialty' : ''}`;
			logResult = rolled;
		}

		await context.pool.query(
			`INSERT INTO dice_log (guild_id, channel_id, discord_user_id, expression, result)
			 VALUES ($1, $2, $3, $4, $5)`,
			[guildId, interaction.channelId, interaction.user.id, expression, JSON.stringify(logResult)]
		);

		const characterName = await activeCharacterName(context, guildId, interaction.user.id);
		const who = characterName ? `<@${interaction.user.id}> (${characterName})` : `<@${interaction.user.id}>`;
		const labelText = label ? ` *${label}*` : '';
		await interaction.reply(`${who}${labelText}: ${resultText}`);
	},
};
