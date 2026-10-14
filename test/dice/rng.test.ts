import { describe, it, expect } from 'vitest';
import { createRng, createFixedRng } from '../../src/dice/rng.js';

describe('createRng', () => {
	it('stays within 1 and the number of sides over many rolls', () => {
		const rng = createRng();
		for (let i = 0; i < 500; i++) {
			const value = rng(6);
			expect(value).toBeGreaterThanOrEqual(1);
			expect(value).toBeLessThanOrEqual(6);
			expect(Number.isInteger(value)).toBe(true);
		}
	});
});

describe('createFixedRng', () => {
	it('returns the given sequence in order', () => {
		const rng = createFixedRng([3, 7, 1]);
		expect(rng(10)).toBe(3);
		expect(rng(10)).toBe(7);
		expect(rng(10)).toBe(1);
	});

	it('throws once the sequence is exhausted', () => {
		const rng = createFixedRng([5]);
		rng(10);
		expect(() => rng(10)).toThrow('fixed RNG sequence exhausted');
	});
});
