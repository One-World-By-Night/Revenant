import { describe, it, expect } from 'vitest';
import { resolvePoolSelection, matchingPools, poolOptionValue } from '../../src/lib/poolSelection.js';
import type { DiscoveredPool } from '../../src/be/temporaryState.js';

const BLOOD: DiscoveredPool = { blockSlug: 'vampire-resources', poolName: 'Blood', permanent: 10, temporary: 7 };
const WILLPOWER: DiscoveredPool = { blockSlug: 'vampire-resources', poolName: 'Willpower', permanent: 6, temporary: 4 };

describe('resolvePoolSelection', () => {
	it('picks the only pool when none is named and the character holds one', () => {
		expect(resolvePoolSelection([BLOOD], null)).toEqual({ kind: 'ok', pool: BLOOD });
	});

	it('is none when the character holds no pools and none is named', () => {
		expect(resolvePoolSelection([], null)).toEqual({ kind: 'none' });
	});

	it('is ambiguous when the character holds several and none is named', () => {
		expect(resolvePoolSelection([BLOOD, WILLPOWER], null)).toEqual({ kind: 'ambiguous', pools: [BLOOD, WILLPOWER] });
	});

	it('finds the named pool by its option value', () => {
		expect(resolvePoolSelection([BLOOD, WILLPOWER], poolOptionValue(WILLPOWER))).toEqual({ kind: 'ok', pool: WILLPOWER });
	});

	it('is notFound when the named option value matches none of the character\'s pools', () => {
		expect(resolvePoolSelection([BLOOD], 'some-other-block:Gnosis')).toEqual({ kind: 'notFound' });
	});
});

describe('matchingPools', () => {
	it('matches by a case-insensitive substring', () => {
		expect(matchingPools([BLOOD, WILLPOWER], 'blo')).toEqual([BLOOD]);
	});

	it('matches everything on an empty query', () => {
		expect(matchingPools([BLOOD, WILLPOWER], '')).toEqual([BLOOD, WILLPOWER]);
	});
});
