import type { Pool } from 'pg';
import { emptyState, type Category, type ChallengeState, type Terms } from './engine.js';

export type ChallengeKind = 'contested' | 'static' | 'simple_test';
export type ChallengeStatus =
	| 'terms_proposed'
	| 'disputed'
	| 'claiming'
	| 'negative_trait'
	| 'throwing'
	| 'resolved'
	| 'overbid'
	| 'retest'
	| 'settled'
	| 'voided'
	| 'expired';

export interface ChallengeRow {
	id: number;
	guildId: string;
	channelId: string;
	kind: ChallengeKind;
	status: ChallengeStatus;
	challengerDiscordId: string;
	defenderDiscordId: string | null;
	narratorDiscordId: string | null;
	category: Category | null;
	conditions: string;
	state: ChallengeState;
	createdAt: Date;
	expiresAt: Date | null;
	settledAt: Date | null;
}

interface ChallengeDbRow {
	id: number;
	guild_id: string;
	channel_id: string;
	kind: ChallengeKind;
	status: ChallengeStatus;
	challenger_discord_id: string;
	defender_discord_id: string | null;
	narrator_discord_id: string | null;
	category: Category | null;
	conditions: string;
	state: ChallengeState;
	created_at: Date;
	expires_at: Date | null;
	settled_at: Date | null;
}

function fromDbRow(row: ChallengeDbRow): ChallengeRow {
	return {
		id: row.id,
		guildId: row.guild_id,
		channelId: row.channel_id,
		kind: row.kind,
		status: row.status,
		challengerDiscordId: row.challenger_discord_id,
		defenderDiscordId: row.defender_discord_id,
		narratorDiscordId: row.narrator_discord_id,
		category: row.category,
		conditions: row.conditions,
		state: row.state,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		settledAt: row.settled_at,
	};
}

export interface CreateChallengeInput {
	guildId: string;
	channelId: string;
	kind: ChallengeKind;
	challengerDiscordId: string;
	defenderDiscordId?: string;
	narratorDiscordId?: string;
	category?: Category;
	conditions: string;
	terms: Terms;
	expiresAt?: Date;
}

export async function createChallenge(pool: Pool, input: CreateChallengeInput): Promise<ChallengeRow> {
	const state = emptyState(input.terms);
	const { rows } = await pool.query<ChallengeDbRow>(
		`INSERT INTO challenges (guild_id, channel_id, kind, status, challenger_discord_id, defender_discord_id, narrator_discord_id, category, conditions, state, expires_at)
		 VALUES ($1, $2, $3, 'terms_proposed', $4, $5, $6, $7, $8, $9, $10)
		 RETURNING *`,
		[
			input.guildId,
			input.channelId,
			input.kind,
			input.challengerDiscordId,
			input.defenderDiscordId ?? null,
			input.narratorDiscordId ?? null,
			input.category ?? null,
			input.conditions,
			JSON.stringify(state),
			input.expiresAt ?? null,
		]
	);
	return fromDbRow(rows[0]!);
}

export async function loadChallenge(pool: Pool, id: number): Promise<ChallengeRow | null> {
	const { rows } = await pool.query<ChallengeDbRow>('SELECT * FROM challenges WHERE id = $1', [id]);
	return rows[0] ? fromDbRow(rows[0]) : null;
}

export async function saveChallenge(pool: Pool, id: number, state: ChallengeState, status: ChallengeStatus): Promise<void> {
	await pool.query('UPDATE challenges SET state = $1, status = $2 WHERE id = $3', [JSON.stringify(state), status, id]);
}

export async function settleChallenge(pool: Pool, id: number, state: ChallengeState): Promise<void> {
	await pool.query("UPDATE challenges SET state = $1, status = 'settled', settled_at = now() WHERE id = $2", [JSON.stringify(state), id]);
}

export async function voidChallenge(pool: Pool, id: number): Promise<void> {
	await pool.query("UPDATE challenges SET status = 'voided' WHERE id = $1", [id]);
}

export async function recentChallengesForDiscordUser(pool: Pool, guildId: string, discordUserId: string, limit = 10): Promise<ChallengeRow[]> {
	const { rows } = await pool.query<ChallengeDbRow>(
		`SELECT * FROM challenges
		 WHERE guild_id = $1 AND (challenger_discord_id = $2 OR defender_discord_id = $2)
		 ORDER BY created_at DESC LIMIT $3`,
		[guildId, discordUserId, limit]
	);
	return rows.map(fromDbRow);
}

export async function recordCost(
	pool: Pool,
	challengeId: number,
	kind: 'trait_lost' | 'ability_expended' | 'wound',
	payload: Record<string, unknown>,
	beChangeId: number | null
): Promise<void> {
	await pool.query('INSERT INTO challenge_costs (challenge_id, kind, payload, be_change_id) VALUES ($1, $2, $3, $4)', [
		challengeId,
		kind,
		JSON.stringify(payload),
		beChangeId,
	]);
}

export interface ChallengeCostRow {
	id: number;
	challengeId: number;
	kind: 'trait_lost' | 'ability_expended' | 'wound';
	payload: Record<string, unknown>;
	beChangeId: number | null;
	reversedAt: Date | null;
}

export async function unreversedCosts(pool: Pool, challengeId: number): Promise<ChallengeCostRow[]> {
	const { rows } = await pool.query<{
		id: number;
		challenge_id: number;
		kind: 'trait_lost' | 'ability_expended' | 'wound';
		payload: Record<string, unknown>;
		be_change_id: number | null;
		reversed_at: Date | null;
	}>('SELECT * FROM challenge_costs WHERE challenge_id = $1 AND reversed_at IS NULL', [challengeId]);
	return rows.map((row) => ({
		id: row.id,
		challengeId: row.challenge_id,
		kind: row.kind,
		payload: row.payload,
		beChangeId: row.be_change_id,
		reversedAt: row.reversed_at,
	}));
}

export async function markCostReversed(pool: Pool, costId: number): Promise<void> {
	await pool.query('UPDATE challenge_costs SET reversed_at = now() WHERE id = $1', [costId]);
}
