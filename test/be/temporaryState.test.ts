import { describe, it, expect } from 'vitest';
import { discoverPools, readWounds, readNightLosses, wasClamped } from '../../src/be/temporaryState.js';

describe('discoverPools', () => {
	it('finds a single pool under its own block', () => {
		const pools = discoverPools({ 'vampire-resources': { Blood: { permanent: 10, temporary: 7 } } });
		expect(pools).toEqual([{ blockSlug: 'vampire-resources', poolName: 'Blood', permanent: 10, temporary: 7 }]);
	});

	it('finds several pools across several blocks', () => {
		const pools = discoverPools({
			'vampire-resources': { Blood: { permanent: 10, temporary: 10 }, Willpower: { permanent: 6, temporary: 4 } },
			'morality-virtues': { Conscience: { permanent: 4, temporary: 4 } },
		});
		expect(pools).toHaveLength(3);
		expect(pools.map((p) => p.poolName).sort()).toEqual(['Blood', 'Conscience', 'Willpower']);
	});

	it('finds no pools on a character with none', () => {
		expect(discoverPools({ 'mortal-abilities': { Brawl: 3 } })).toEqual([]);
	});

	it('ignores a block that holds no pool-shaped values at all', () => {
		expect(discoverPools({ 'mortal-identity': { Name: 'Rosa Alvarez', Age: 34 } })).toEqual([]);
	});

	it('ignores reserved keys that are not pool blocks', () => {
		const pools = discoverPools({
			_wound_state: { bashing: 1, lethal: 0, aggravated: 0 },
			_night_losses: { lost_traits: [], expended_abilities: [] },
		});
		expect(pools).toEqual([]);
	});
});

describe('readWounds', () => {
	it('reads a stored wound state', () => {
		expect(readWounds({ _wound_state: { bashing: 2, lethal: 4, aggravated: 0 } })).toEqual({ bashing: 2, lethal: 4, aggravated: 0 });
	});

	it('defaults to all zeros when the character has never been wounded', () => {
		expect(readWounds({})).toEqual({ bashing: 0, lethal: 0, aggravated: 0 });
	});
});

describe('readNightLosses', () => {
	it('reads stored losses', () => {
		const losses = readNightLosses({
			_night_losses: {
				lost_traits: [{ block_slug: 'vampire-abilities', name: 'Brawl' }],
				expended_abilities: [{ block_slug: 'vampire-abilities', name: 'Occult', levels: 2 }],
			},
		});
		expect(losses.lost_traits).toHaveLength(1);
		expect(losses.expended_abilities).toHaveLength(1);
	});

	it('defaults to empty lists when nothing has been lost tonight', () => {
		expect(readNightLosses({})).toEqual({ lost_traits: [], expended_abilities: [] });
	});
});

describe('wasClamped', () => {
	it('is false when the pool moved by exactly the requested delta', () => {
		expect(wasClamped(7, -2, 5)).toBe(false);
	});

	it('is true when the pool hit its floor before the full delta applied', () => {
		expect(wasClamped(1, -2, 0)).toBe(true);
	});

	it('is true when the pool hit its ceiling before the full delta applied', () => {
		expect(wasClamped(9, 2, 10)).toBe(true);
	});
});
