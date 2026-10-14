import { describe, it, expect } from 'vitest';
import { createTtlCache } from '../../src/lib/ttlCache.js';

describe('createTtlCache', () => {
	it('returns undefined for a key never set', () => {
		const cache = createTtlCache<string>(1000);
		expect(cache.get('missing', 0)).toBeUndefined();
	});

	it('returns a value set within the ttl window', () => {
		const cache = createTtlCache<string>(1000);
		cache.set('a', 'value', 0);
		expect(cache.get('a', 999)).toBe('value');
	});

	it('expires a value exactly at the ttl boundary', () => {
		const cache = createTtlCache<string>(1000);
		cache.set('a', 'value', 0);
		expect(cache.get('a', 1000)).toBeUndefined();
	});

	it('lets a fresh set reset the expiry for the same key', () => {
		const cache = createTtlCache<string>(1000);
		cache.set('a', 'first', 0);
		cache.set('a', 'second', 500);
		expect(cache.get('a', 1400)).toBe('second');
	});
});
