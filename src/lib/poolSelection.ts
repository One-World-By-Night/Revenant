import type { DiscoveredPool } from '../be/temporaryState.js';

export type PoolSelection =
	| { kind: 'ok'; pool: DiscoveredPool }
	| { kind: 'none' }
	| { kind: 'ambiguous'; pools: DiscoveredPool[] }
	| { kind: 'notFound' };

/**
 * The autocomplete option value for one of a character's pools - carries the real block slug, never
 * just the pool's display name, since two blocks could in principle hold a same-named pool.
 */
export function poolOptionValue(pool: DiscoveredPool): string {
	return `${pool.blockSlug}:${pool.poolName}`;
}

function findByOptionValue(pools: DiscoveredPool[], value: string): DiscoveredPool | undefined {
	return pools.find((pool) => poolOptionValue(pool) === value);
}

/**
 * Up to 25 of a character's pools whose name contains the autocomplete query, case-insensitive.
 */
export function matchingPools(pools: DiscoveredPool[], query: string): DiscoveredPool[] {
	const lowered = query.toLowerCase();
	return pools.filter((pool) => pool.poolName.toLowerCase().includes(lowered)).slice(0, 25);
}

/**
 * Resolves which pool `/spend` or `/regain` should act on: the one named by `optionValue` when one
 * is given; otherwise the character's only pool when it holds exactly one; `none` when it holds
 * none at all; `ambiguous` when it holds several and none was named.
 */
export function resolvePoolSelection(pools: DiscoveredPool[], optionValue: string | null): PoolSelection {
	if (optionValue !== null) {
		const pool = findByOptionValue(pools, optionValue);
		return pool ? { kind: 'ok', pool } : { kind: 'notFound' };
	}
	if (pools.length === 0) {
		return { kind: 'none' };
	}
	if (pools.length === 1) {
		return { kind: 'ok', pool: pools[0]! };
	}
	return { kind: 'ambiguous', pools };
}
