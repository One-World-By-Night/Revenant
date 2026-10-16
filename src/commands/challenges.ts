import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { activeCharacterFor } from '../challenges/activeCharacter.js';
import {
	loadChallenge,
	recentChallengesForDiscordUser,
	voidChallenge,
	unreversedCosts,
	markCostReversed,
	type ChallengeRow,
} from '../challenges/store.js';
import { reverseCost, type CostTarget, type AppliedCost } from '../challenges/costs.js';
import type { Side } from '../challenges/engine.js';
import type { Connection } from '../be/temporaryState.js';

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

async function requireStoryteller(
	interaction: ChatInputCommandInteraction,
	context: CommandContext,
	connection: ConnectionRow,
	secret: Buffer,
	locale: ReturnType<typeof resolveLocale>
): Promise<boolean> {
	try {
		const capabilities = await callBe<{ capabilities: Record<string, boolean> }>(connection.rest_root, {
			method: 'GET',
			route: `/be/v1/${connection.game_slug}/my/capabilities`,
			signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: interaction.user.id },
		});
		if (!capabilities.capabilities.be_manage_characters) {
			await interaction.editReply(t(locale, 'shared.storytellersOnly'));
			return false;
		}
		return true;
	} catch (error) {
		if (error instanceof BeApiError && error.kind === 'user_not_linked') {
			await interaction.editReply(t(locale, 'shared.userNotLinked'));
			return false;
		}
		context.logger.warn({ error: error instanceof Error ? error.message : String(error) }, '/challenges capability check failed');
		await interaction.editReply(t(locale, 'shared.unreachable'));
		return false;
	}
}

/**
 * Reverses every unreversed cost a challenge has, resolving each side's character the same way
 * `/challenge` itself did at settlement time - the current active character for the discord id the
 * challenge was played under, never a character id persisted on the row.
 */
async function reverseAllCosts(context: CommandContext, beConnection: Connection, secret: Buffer, guildId: string, challenge: ChallengeRow, reason: string): Promise<number> {
	const costs = await unreversedCosts(context.pool, challenge.id);
	if (costs.length === 0) {
		return 0;
	}

	const challengerActive = await activeCharacterFor(context.pool, beConnection, secret, guildId, challenge.challengerDiscordId);
	const defenderActive = challenge.defenderDiscordId
		? await activeCharacterFor(context.pool, beConnection, secret, guildId, challenge.defenderDiscordId)
		: null;

	const target: CostTarget = {
		challenger: challengerActive ? { characterId: challengerActive.id, discordUserId: challenge.challengerDiscordId } : null,
		defender: defenderActive && challenge.defenderDiscordId ? { characterId: defenderActive.id, discordUserId: challenge.defenderDiscordId } : null,
		reason,
		traitLocations: [],
		abilityLocations: [],
	};

	for (const cost of costs) {
		const side = (cost.payload.side as Side | undefined) ?? 'challenger';
		const noCharacter = cost.payload.noCharacter === true;
		const appliedCost: AppliedCost = { side, kind: cost.kind, payload: cost.payload, ...(noCharacter ? { noCharacter: true } : {}) };
		await reverseCost(beConnection, secret, appliedCost, target, reason);
		await markCostReversed(context.pool, cost.id);
	}
	return costs.length;
}

function describeThrowOutcome(challenge: ChallengeRow, locale: ReturnType<typeof resolveLocale>): string {
	const outcome = challenge.state.outcome;
	if (!outcome) {
		return t(locale, 'challenges.logNoOutcome');
	}
	const loserLabel = outcome.loser === 'both' ? `${challenge.challengerDiscordId}/${challenge.defenderDiscordId}` : outcome.loser;
	const traits = outcome.lostTraits.join(', ') || '—';
	return t(locale, 'challenges.logOutcome', { loser: loserLabel, traits });
}

export const challengesCommand = {
	data: new SlashCommandBuilder()
		.setName('challenges')
		.setDescription("Look up or correct this chronicle's challenges")
		.setDescriptionLocalizations({ 'pt-BR': 'Consulta ou corrige os desafios desta crônica' })
		.addSubcommand((sub) =>
			sub
				.setName('history')
				.setDescription('Your own recent challenges')
				.setDescriptionLocalizations({ 'pt-BR': 'Seus próprios desafios recentes' })
				.addUserOption((option) =>
					option
						.setName('opponent')
						.setDescription('Only challenges against this account')
						.setDescriptionLocalizations({ 'pt-BR': 'Só desafios contra esta conta' })
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName('log')
				.setDescription('The full record of one challenge (Storytellers only)')
				.setDescriptionLocalizations({ 'pt-BR': 'O registro completo de um desafio (só Storytellers)' })
				.addIntegerOption((option) => option.setName('id').setDescription('The challenge number').setRequired(true))
		)
		.addSubcommand((sub) =>
			sub
				.setName('void')
				.setDescription('Cancel a challenge and reverse its costs (Storytellers only)')
				.setDescriptionLocalizations({ 'pt-BR': 'Cancela um desafio e reverte seus custos (só Storytellers)' })
				.addIntegerOption((option) => option.setName('id').setDescription('The challenge number').setRequired(true))
				.addStringOption((option) => option.setName('reason').setDescription('Why - logged on every reversed cost'))
		)
		.addSubcommand((sub) =>
			sub
				.setName('correct')
				.setDescription("Reverse a settled challenge's costs without voiding it (Storytellers only)")
				.setDescriptionLocalizations({ 'pt-BR': 'Reverte os custos de um desafio resolvido sem anulá-lo (só Storytellers)' })
				.addIntegerOption((option) => option.setName('id').setDescription('The challenge number').setRequired(true))
				.addStringOption((option) => option.setName('reason').setDescription('Why - logged on every reversed cost'))
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;
		const subcommand = interaction.options.getSubcommand(true);

		if (subcommand === 'history') {
			const opponent = interaction.options.getUser('opponent');
			const rows = (await recentChallengesForDiscordUser(context.pool, guildId, interaction.user.id)).filter(
				(row) => !opponent || row.challengerDiscordId === opponent.id || row.defenderDiscordId === opponent.id
			);
			if (rows.length === 0) {
				await interaction.reply({ content: t(locale, 'challenges.historyEmpty'), flags: MessageFlags.Ephemeral });
				return;
			}
			const lines = rows.map((row) =>
				t(locale, 'challenges.historyLine', { id: row.id, kind: row.kind, category: row.category ?? '—', status: row.status, conditions: row.conditions })
			);
			await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
			return;
		}

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };

		if (!(await requireStoryteller(interaction, context, connection, secret, locale))) {
			return;
		}

		const id = interaction.options.getInteger('id', true);
		const challenge = await loadChallenge(context.pool, id);
		if (!challenge || challenge.guildId !== guildId) {
			await interaction.editReply(t(locale, 'challenges.notFound'));
			return;
		}

		if (subcommand === 'log') {
			const state = challenge.state;
			const lines = [
				t(locale, 'challenges.logHeader', { id: challenge.id, kind: challenge.kind, status: challenge.status, conditions: challenge.conditions, traits: state.terms.appropriateTraits || '—' }),
				t(locale, 'challenges.logSide', {
					label: 'Challenger',
					traitCount: state.challenger.claim?.traitCount ?? 0,
					bomb: state.challenger.claim?.hasBomb ? t(locale, 'challenges.logBombYes') : '',
					bids: state.challenger.bids.map((b) => b.trait).join(', ') || t(locale, 'challenges.logNoBids'),
				}),
				t(locale, 'challenges.logSide', {
					label: 'Defender',
					traitCount: state.defender.claim?.traitCount ?? 0,
					bomb: state.defender.claim?.hasBomb ? t(locale, 'challenges.logBombYes') : '',
					bids: state.defender.bids.map((b) => b.trait).join(', ') || t(locale, 'challenges.logNoBids'),
				}),
				state.throws.length > 0 ? t(locale, 'challenges.logThrows', { count: state.throws.length }) : t(locale, 'challenges.logNoThrows'),
				describeThrowOutcome(challenge, locale),
			];
			const costs = await unreversedCosts(context.pool, challenge.id);
			lines.push(t(locale, 'challenges.logCosts', { count: costs.length }));
			await interaction.editReply(lines.join('\n'));
			return;
		}

		const reason = interaction.options.getString('reason') ?? t(locale, 'challenges.defaultCorrectionReason');
		const reversedCount = await reverseAllCosts(context, beConnection, secret, guildId, challenge, reason);

		if (subcommand === 'void') {
			await voidChallenge(context.pool, challenge.id);
			await interaction.editReply(t(locale, 'challenges.voided', { id: challenge.id, count: reversedCount }));
			return;
		}

		await interaction.editReply(
			reversedCount > 0 ? t(locale, 'challenges.corrected', { id: challenge.id, count: reversedCount }) : t(locale, 'challenges.noCostsToReverse', { id: challenge.id })
		);
	},
};
