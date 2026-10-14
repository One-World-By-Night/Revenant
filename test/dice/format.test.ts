import { describe, it, expect } from 'vitest';
import { formatNotationResult, formatPoolResult } from '../../src/dice/format.js';
import { rollNotation } from '../../src/dice/roll.js';
import { rollPool } from '../../src/dice/pools.js';
import { createFixedRng } from '../../src/dice/rng.js';
import type { ParsedNotation } from '../../src/dice/notation.js';

describe('formatNotationResult', () => {
	it('renders a single die with no parens', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 1, sides: 100 }] };
		const result = rollNotation(notation, createFixedRng([42]));
		expect(formatNotationResult(result)).toBe('42 = **42**');
	});

	it('renders a dice term plus a number term', () => {
		const notation: ParsedNotation = {
			terms: [
				{ kind: 'dice', sign: 1, count: 2, sides: 6 },
				{ kind: 'number', sign: 1, value: 3 },
			],
		};
		const result = rollNotation(notation, createFixedRng([4, 5]));
		expect(formatNotationResult(result)).toBe('(4 + 5) + 3 = **12**');
	});

	it('strikes through a die dropped by a keep modifier', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 3, sides: 6, keep: { mode: 'highest', count: 2 } }] };
		const result = rollNotation(notation, createFixedRng([6, 2, 5]));
		expect(formatNotationResult(result)).toBe('(6 + ~~2~~ + 5) = **11**');
	});

	it('marks an exploded die with !, struck through too if it was also dropped', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 2, sides: 6, exploding: true }] };
		const result = rollNotation(notation, createFixedRng([6, 3, 4]));
		expect(formatNotationResult(result)).toBe('(6! + 3 + 4) = **13**');
	});

	it('shows a minus sign before a subtracted term', () => {
		const notation: ParsedNotation = {
			terms: [
				{ kind: 'number', sign: 1, value: 10 },
				{ kind: 'number', sign: -1, value: 4 },
			],
		};
		const result = rollNotation(notation, createFixedRng([]));
		expect(formatNotationResult(result)).toBe('10 - 4 = **6**');
	});
});

describe('formatPoolResult', () => {
	it('bolds successes and names the outcome by its success count', () => {
		const result = rollPool(4, 6, 'v20', false, createFixedRng([8, 3, 2, 5]));
		expect(formatPoolResult(result)).toBe('**8**, 3, 2, 5 — **1 success**');
	});

	it('uses the plural for more than one success', () => {
		const result = rollPool(4, 6, 'v20', false, createFixedRng([8, 7, 2, 5]));
		expect(formatPoolResult(result)).toBe('**8**, **7**, 2, 5 — **2 successes**');
	});

	it('reads Botch for a botch outcome', () => {
		const result = rollPool(5, 8, 'v20', false, createFixedRng([1, 3, 4, 3, 7]));
		expect(formatPoolResult(result)).toBe('1, 3, 4, 3, 7 — **Botch**');
	});

	it('reads Failure when raw successes are fully canceled', () => {
		const result = rollPool(5, 8, 'v20', false, createFixedRng([9, 1, 1, 8, 1]));
		expect(formatPoolResult(result)).toBe('**9**, 1, 1, **8**, 1 — **Failure**');
	});

	it('shows extra rerolled dice separately', () => {
		const result = rollPool(2, 6, 'revised', true, createFixedRng([10, 3, 7]));
		expect(formatPoolResult(result)).toBe('**10**, 3 (extra: **7**) — **2 successes**');
	});
});
