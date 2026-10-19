import {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	type ChatInputCommandInteraction,
	type ButtonInteraction,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, type Locale } from '../i18n/index.js';
import { activeCharacterFor } from '../challenges/activeCharacter.js';
import { loadGuildSettings } from './settings.js';
import { createChallenge, loadChallenge, saveChallenge, settleChallenge, type ChallengeRow } from '../challenges/store.js';
import { throwGestures, latestThrow, otherSide, type Gesture, type Side, type Terms } from '../challenges/engine.js';
import type { Connection } from '../be/temporaryState.js';

const GESTURE_PREFIX = 'test:throw:';
const GESTURES: Array<Exclude<Gesture, 'bomb'>> = ['rock', 'paper', 'scissors'];
const GESTURE_LABEL_KEY: Record<Exclude<Gesture, 'bomb'>, string> = {
	rock: 'challenge.gestureRock',
	paper: 'challenge.gesturePaper',
	scissors: 'challenge.gestureScissors',
};

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

function sideFor(challenge: ChallengeRow, discordUserId: string): Side | null {
	if (challenge.challengerDiscordId === discordUserId) {
		return 'challenger';
	}
	if (challenge.defenderDiscordId === discordUserId) {
		return 'defender';
	}
	return null;
}

function gestureRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		...GESTURES.map((gesture) =>
			new ButtonBuilder().setCustomId(`${GESTURE_PREFIX}${gesture}`).setLabel(t(locale, GESTURE_LABEL_KEY[gesture])).setStyle(ButtonStyle.Secondary)
		)
	);
}

const EMPTY_TERMS: Terms = {
	category: null,
	conditions: '',
	appropriateTraits: '',
	challengerSources: [],
	defenderSources: [],
	challengerBlockers: [],
	defenderBlockers: [],
};

export const testCommand = {
	data: new SlashCommandBuilder()
		.setName('test')
		.setDescription('A simple throw against a Narrator, usually won on a win or a tie')
		.setDescriptionLocalizations({ 'pt-BR': 'Uma jogada simples contra um Narrador, geralmente vencida com vitória ou empate' })
		.addUserOption((option) =>
			option
				.setName('narrator')
				.setDescription('The Narrator or Storyteller running this test')
				.setDescriptionLocalizations({ 'pt-BR': 'O Narrador ou Storyteller que conduz este teste' })
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('conditions')
				.setDescription('What is being tested')
				.setDescriptionLocalizations({ 'pt-BR': 'O que está sendo testado' })
				.setRequired(true)
		)
		.addBooleanOption((option) =>
			option
				.setName('require_win')
				.setDescription('Only a win succeeds - a tie fails too')
				.setDescriptionLocalizations({ 'pt-BR': 'Só uma vitória tem sucesso - um empate também falha' })
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale: Locale = interaction.locale === 'pt-BR' ? 'pt-BR' : 'en-US';
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}
		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };

		const narrator = interaction.options.getUser('narrator', true);
		if (narrator.id === interaction.user.id) {
			await interaction.reply({ content: t(locale, 'challenge.cannotBeYourself'), flags: MessageFlags.Ephemeral });
			return;
		}
		const conditions = interaction.options.getString('conditions', true);
		const requireWin = interaction.options.getBoolean('require_win') ?? false;

		const playerActive = await activeCharacterFor(context.pool, beConnection, secret, guildId, interaction.user.id);
		if (!playerActive) {
			await interaction.reply({ content: t(locale, 'challenge.noActiveCharacter'), flags: MessageFlags.Ephemeral });
			return;
		}

		const settings = await loadGuildSettings(context, guildId);
		const expiresAt = new Date(Date.now() + settings.challenge_timeout_minutes * 60 * 1000);

		const challenge = await createChallenge(context.pool, {
			guildId,
			channelId: interaction.channelId,
			kind: 'simple_test',
			challengerDiscordId: interaction.user.id,
			defenderDiscordId: narrator.id,
			conditions,
			terms: EMPTY_TERMS,
			expiresAt,
		});

		const postedText = t(locale, 'test.posted', { player: playerActive.name, narrator: narrator.username, conditions });
		await interaction.reply({ content: postedText, components: [gestureRow(locale)] });
		const message = await interaction.fetchReply();

		const collector = message.createMessageComponentCollector({
			filter: (i) => i.user.id === interaction.user.id || i.user.id === narrator.id,
			time: settings.challenge_timeout_minutes * 60 * 1000,
		});

		async function handleThrow(buttonInteraction: ButtonInteraction, gesture: Gesture): Promise<void> {
			const current = await loadChallenge(context.pool, challenge.id);
			if (!current) {
				return;
			}
			const side = sideFor(current, buttonInteraction.user.id);
			if (!side) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.notYourChallenge'), flags: MessageFlags.Ephemeral });
				return;
			}
			if (current.state[side].gesture !== null) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.alreadyThrown'), flags: MessageFlags.Ephemeral });
				return;
			}

			let next = current.state;
			next[side] = { ...next[side], gesture };
			const otherGesture = next[otherSide(side)].gesture;
			await buttonInteraction.reply({ content: t(locale, 'challenge.gestureRecorded'), flags: MessageFlags.Ephemeral });

			if (otherGesture === null) {
				await saveChallenge(context.pool, challenge.id, next, 'throwing');
				return;
			}

			const challengerGesture = side === 'challenger' ? gesture : (otherGesture as Gesture);
			const defenderGesture = side === 'defender' ? gesture : (otherGesture as Gesture);
			const thrown = throwGestures(next, challengerGesture, defenderGesture);
			const last = latestThrow(thrown)!;
			const succeeded = last.winner === 'challenger' || (last.winner === 'draw' && !requireWin);

			await settleChallenge(context.pool, challenge.id, thrown);
			const resultText = t(locale, succeeded ? 'test.succeeded' : 'test.failed', { player: playerActive!.name });
			await message.edit({ content: `${postedText}\n\n${resultText}`, components: [] }).catch(() => undefined);
			collector.stop();
		}

		collector.on('collect', (buttonInteraction: ButtonInteraction) => {
			if (buttonInteraction.customId.startsWith(GESTURE_PREFIX)) {
				const gesture = buttonInteraction.customId.slice(GESTURE_PREFIX.length) as Gesture;
				if ((GESTURES as string[]).includes(gesture)) {
					handleThrow(buttonInteraction, gesture).catch((error: unknown) => {
						context.logger.error({ error: error instanceof Error ? error.message : String(error) }, 'test throw handling failed');
					});
				}
			}
		});
	},
};
