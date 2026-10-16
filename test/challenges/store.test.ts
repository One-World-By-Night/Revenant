import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import {
	createChallenge,
	loadChallenge,
	saveChallenge,
	settleChallenge,
	voidChallenge,
	recentChallengesForDiscordUser,
	recordCost,
	unreversedCosts,
	markCostReversed,
} from '../../src/challenges/store.js';
import { submitClaim, type Terms, type Claim } from '../../src/challenges/engine.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool } = pg;

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:devpassword@localhost:55432/berevenant_test';
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');
const pool = new Pool({ connectionString: DATABASE_URL });

function terms(): Terms {
	return {
		category: 'physical',
		conditions: 'I swing my sword at you',
		appropriateTraits: 'Strength, Melee',
		challengerSources: ['Melee'],
		defenderSources: ['Dodge'],
		challengerBlockers: ['Alertness'],
		defenderBlockers: ['Intimidation'],
	};
}

beforeAll(async () => {
	await pool.query('DROP SCHEMA public CASCADE');
	await pool.query('CREATE SCHEMA public');
	await runMigrations(pool, MIGRATIONS_DIR);
});

beforeEach(async () => {
	await pool.query('DELETE FROM challenge_costs');
	await pool.query('DELETE FROM challenges');
});

afterAll(async () => {
	await pool.end();
});

describe('createChallenge / loadChallenge', () => {
	it('round trips a real row, terms and all', async () => {
		const created = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u1',
			defenderDiscordId: 'u2',
			category: 'physical',
			conditions: 'I swing my sword at you',
			terms: terms(),
		});
		expect(created.status).toBe('terms_proposed');
		expect(created.state.terms).toEqual(terms());

		const loaded = await loadChallenge(pool, created.id);
		expect(loaded?.challengerDiscordId).toBe('u1');
		expect(loaded?.defenderDiscordId).toBe('u2');
		expect(loaded?.state.terms.challengerSources).toEqual(['Melee']);
	});

	it('is null for an id that does not exist', async () => {
		expect(await loadChallenge(pool, 999999)).toBeNull();
	});
});

describe('saveChallenge', () => {
	it('persists a mutated state and a new status', async () => {
		const created = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u1',
			defenderDiscordId: 'u2',
			conditions: 'a test',
			terms: terms(),
		});
		const claim: Claim = { traitCount: 3, hasBomb: false, retestSource: null, bidTrait: 'Brawn' };
		const next = submitClaim(created.state, 'challenger', claim);
		await saveChallenge(pool, created.id, next, 'claiming');

		const reloaded = await loadChallenge(pool, created.id);
		expect(reloaded?.status).toBe('claiming');
		expect(reloaded?.state.challenger.claim).toEqual(claim);
	});
});

describe('settleChallenge / voidChallenge', () => {
	it('settling stamps settled_at and the final status', async () => {
		const created = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'simple_test',
			challengerDiscordId: 'u1',
			conditions: 'a quick test',
			terms: terms(),
		});
		await settleChallenge(pool, created.id, created.state);
		const reloaded = await loadChallenge(pool, created.id);
		expect(reloaded?.status).toBe('settled');
		expect(reloaded?.settledAt).not.toBeNull();
	});

	it('voiding needs no state change at all', async () => {
		const created = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u1',
			conditions: 'a test',
			terms: terms(),
		});
		await voidChallenge(pool, created.id);
		const reloaded = await loadChallenge(pool, created.id);
		expect(reloaded?.status).toBe('voided');
	});
});

describe('recentChallengesForDiscordUser', () => {
	it('finds a challenge by either side, scoped to the guild', async () => {
		const asChallenger = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u1',
			defenderDiscordId: 'u2',
			conditions: 'a test',
			terms: terms(),
		});
		const asDefender = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u3',
			defenderDiscordId: 'u1',
			conditions: 'another test',
			terms: terms(),
		});
		await createChallenge(pool, {
			guildId: 'g2',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u1',
			defenderDiscordId: 'u2',
			conditions: 'a different guild',
			terms: terms(),
		});

		const found = await recentChallengesForDiscordUser(pool, 'g1', 'u1');
		expect(found.map((c) => c.id).sort()).toEqual([asChallenger.id, asDefender.id].sort());
	});
});

describe('challenge costs', () => {
	it('records a cost and finds it as unreversed', async () => {
		const created = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u1',
			conditions: 'a test',
			terms: terms(),
		});
		await recordCost(pool, created.id, 'trait_lost', { trait: 'Brawn' }, 42);

		const costs = await unreversedCosts(pool, created.id);
		expect(costs).toHaveLength(1);
		expect(costs[0]!.beChangeId).toBe(42);
	});

	it('a reversed cost drops out of the unreversed list', async () => {
		const created = await createChallenge(pool, {
			guildId: 'g1',
			channelId: 'c1',
			kind: 'contested',
			challengerDiscordId: 'u1',
			conditions: 'a test',
			terms: terms(),
		});
		await recordCost(pool, created.id, 'trait_lost', { trait: 'Brawn' }, null);
		const [cost] = await unreversedCosts(pool, created.id);

		await markCostReversed(pool, cost!.id);

		expect(await unreversedCosts(pool, created.id)).toHaveLength(0);
	});
});
