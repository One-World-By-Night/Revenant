import { describe, it, expect } from 'vitest';
import { rollNotation } from '../../src/dice/roll.js';
import { createFixedRng } from '../../src/dice/rng.js';
import type { ParsedNotation } from '../../src/dice/notation.js';

describe('rollNotation', () => {
	it('sums a dice term and a flat number', () => {
		const notation: ParsedNotation = {
			terms: [
				{ kind: 'dice', sign: 1, count: 2, sides: 6 },
				{ kind: 'number', sign: 1, value: 3 },
			],
		};
		const result = rollNotation(notation, createFixedRng([4, 5]));
		expect(result.total).toBe(4 + 5 + 3);
		expect(result.terms[0]?.dice.every((die) => die.kept)).toBe(true);
	});

	it('subtracts a term with a negative sign', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'number', sign: 1, value: 10 }, { kind: 'number', sign: -1, value: 4 }] };
		expect(rollNotation(notation, createFixedRng([])).total).toBe(6);
	});

	it('keeps only the highest K dice and strikes the rest, breaking ties by roll order', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 3, sides: 6, keep: { mode: 'highest', count: 2 } }] };
		const result = rollNotation(notation, createFixedRng([6, 6, 2]));
		const dice = result.terms[0]?.dice ?? [];
		expect(dice.map((die) => die.kept)).toEqual([true, true, false]);
		expect(result.total).toBe(12);
	});

	it('keeps only the lowest K dice', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 3, sides: 6, keep: { mode: 'lowest', count: 1 } }] };
		const result = rollNotation(notation, createFixedRng([5, 1, 4]));
		const dice = result.terms[0]?.dice ?? [];
		expect(dice.map((die) => die.kept)).toEqual([false, true, false]);
		expect(result.total).toBe(1);
	});

	it('rolls every die in a dice term with no keep modifier', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 4, sides: 10 }] };
		const result = rollNotation(notation, createFixedRng([1, 2, 3, 4]));
		expect(result.total).toBe(10);
		expect(result.terms[0]?.dice).toHaveLength(4);
	});

	it('explodes a maximum die into an extra die, added to the total', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 2, sides: 6, exploding: true }] };
		const result = rollNotation(notation, createFixedRng([6, 3, 4]));
		const dice = result.terms[0]?.dice ?? [];
		expect(dice.map((die) => die.value)).toEqual([6, 3, 4]);
		expect(dice.map((die) => die.exploded)).toEqual([true, false, false]);
		expect(result.total).toBe(13);
	});

	it('cascades while the extra die also explodes', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 1, sides: 6, exploding: true }] };
		const result = rollNotation(notation, createFixedRng([6, 6, 2]));
		expect(result.total).toBe(14);
		expect(result.terms[0]?.dice.map((die) => die.exploded)).toEqual([true, true, false]);
	});

	it('does not explode a die that is not at the maximum face', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 1, sides: 6, exploding: true }] };
		const result = rollNotation(notation, createFixedRng([5]));
		expect(result.terms[0]?.dice).toHaveLength(1);
		expect(result.total).toBe(5);
	});

	it('caps a cascade so an always-maximum die cannot hang the roll', () => {
		const notation: ParsedNotation = { terms: [{ kind: 'dice', sign: 1, count: 1, sides: 2, exploding: true }] };
		const result = rollNotation(notation, () => 2);
		expect(result.terms[0]?.dice).toHaveLength(101);
	});

	it('applies a keep modifier over the full exploded set of dice', () => {
		const notation: ParsedNotation = {
			terms: [{ kind: 'dice', sign: 1, count: 2, sides: 6, exploding: true, keep: { mode: 'highest', count: 2 } }],
		};
		const result = rollNotation(notation, createFixedRng([6, 1, 5]));
		const dice = result.terms[0]?.dice ?? [];
		expect(dice.map((die) => die.kept)).toEqual([true, false, true]);
		expect(result.total).toBe(11);
	});
});
