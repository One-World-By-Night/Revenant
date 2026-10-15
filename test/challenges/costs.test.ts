import { describe, it, expect } from 'vitest';
import { applyCosts, reverseCost, type CostTarget, type AppliedCost } from '../../src/challenges/costs.js';
import type { Outcome } from '../../src/challenges/engine.js';
import type { Connection } from '../../src/be/temporaryState.js';

const connection: Connection = { be_connection_id: 1, rest_root: 'https://example.test/wp-json/', game_slug: 'unused' };
const secret = Buffer.alloc(32);

function target(overrides: Partial<CostTarget> = {}): CostTarget {
	return {
		challenger: { characterId: 1, discordUserId: 'challenger-id' },
		defender: null,
		reason: 'Lost a Physical challenge against a Narrator',
		traitLocations: [{ trait: 'Brawl', blockSlug: 'vampire-abilities' }],
		abilityLocations: [{ trait: 'Occult', blockSlug: 'vampire-abilities' }],
		...overrides,
	};
}

describe('applyCosts against a side with no BE character', () => {
	it('records a lost Trait for the bot\'s own tracking, with no BE call attempted', async () => {
		const outcome: Outcome = { loser: 'defender', lostTraits: ['Brawl'], expendedAbilities: [] };
		const applied = await applyCosts(connection, secret, outcome, target());
		expect(applied).toEqual([{ side: 'defender', kind: 'trait_lost', payload: { trait: 'Brawl' }, noCharacter: true }]);
	});

	it('records an expended Ability the same way', async () => {
		const outcome: Outcome = { loser: 'defender', lostTraits: [], expendedAbilities: ['Occult'] };
		const applied = await applyCosts(connection, secret, outcome, target());
		expect(applied).toEqual([{ side: 'defender', kind: 'ability_expended', payload: { ability: 'Occult' }, noCharacter: true }]);
	});

	it('records a wound the same way and returns before any BE call', async () => {
		const outcome: Outcome = { loser: 'defender', lostTraits: [], expendedAbilities: [] };
		const applied = await applyCosts(connection, secret, outcome, target({ wound: { type: 'lethal', amount: 2, armor: 1 } }));
		expect(applied).toEqual([{ side: 'defender', kind: 'wound', payload: { type: 'lethal', amount: 2, armor: 1 }, noCharacter: true }]);
	});

	it('skips a losing side that has traits but no matching trait location, same as a real character', async () => {
		const outcome: Outcome = { loser: 'defender', lostTraits: ['Unknown Trait'], expendedAbilities: [] };
		const applied = await applyCosts(connection, secret, outcome, target());
		expect(applied).toEqual([]);
	});
});

describe('reverseCost against a side with no BE character', () => {
	it('does nothing - there was never a BE write to undo', async () => {
		const cost: AppliedCost = { side: 'defender', kind: 'trait_lost', payload: { trait: 'Brawl' }, noCharacter: true };
		await expect(reverseCost(connection, secret, cost, target(), 'Correcting a mistake')).resolves.toBeUndefined();
	});
});
