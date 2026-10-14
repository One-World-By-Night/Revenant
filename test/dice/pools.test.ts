import { describe, it, expect } from 'vitest';
import { rollPool, validatePool } from '../../src/dice/pools.js';
import { createFixedRng } from '../../src/dice/rng.js';

describe('validatePool', () => {
	it('accepts the full stated range', () => {
		expect(validatePool(1, 2)).toEqual({ ok: true });
		expect(validatePool(30, 10)).toEqual({ ok: true });
	});

	it('refuses a pool outside 1-30', () => {
		expect(validatePool(0, 6).ok).toBe(false);
		expect(validatePool(31, 6).ok).toBe(false);
	});

	it('refuses a difficulty outside 2-10', () => {
		expect(validatePool(5, 1).ok).toBe(false);
		expect(validatePool(5, 11).ok).toBe(false);
	});
});

describe('rollPool, the book\'s own worked examples', () => {
	it('V20 p.249: Wits+Subterfuge difficulty 7, rolls 2,5,6,6,4,3 - no successes, no botch', () => {
		const result = rollPool(6, 7, 'v20', false, createFixedRng([2, 5, 6, 6, 4, 3]));
		expect(result.successes).toBe(0);
		expect(result.outcome).toBe('failure');
	});

	it('V20 p.250: Stamina+Athletics difficulty 8, rolls 9,1,1,8,1 - a raw success survives, so it is a failure, not a botch', () => {
		const result = rollPool(5, 8, 'v20', false, createFixedRng([9, 1, 1, 8, 1]));
		expect(result.outcome).toBe('failure');
		expect(result.successes).toBe(0);
	});

	it('V20 p.250: the next roll, 1,3,4,3,7 at difficulty 8 - no raw success and a 1 present, a botch', () => {
		const result = rollPool(5, 8, 'v20', false, createFixedRng([1, 3, 4, 3, 7]));
		expect(result.outcome).toBe('botch');
	});

	it('Revised p.117-191: Victoria\'s Charisma+Performance 8, specialty, scores three successes including two 10s, each 10 rerolled for 9 and 7', () => {
		const result = rollPool(8, 6, 'revised', true, createFixedRng([10, 10, 7, 2, 3, 4, 5, 2, 9, 7]));
		expect(result.dice.map((die) => die.value)).toEqual([10, 10, 7, 2, 3, 4, 5, 2]);
		expect(result.extraDice.map((die) => die.value)).toEqual([9, 7]);
		expect(result.successes).toBe(5);
		expect(result.outcome).toBe('success');
	});
});

describe('rollPool, specialty rule difference between the two books', () => {
	const dice = [10, 6, 3, 1];

	it('Revised rerolls a 10 and judges the extra die the same way', () => {
		const result = rollPool(4, 6, 'revised', true, createFixedRng([...dice, 4]));
		expect(result.extraDice).toHaveLength(1);
		expect(result.extraDice[0]?.value).toBe(4);
		expect(result.successes).toBe(1);
	});

	it('V20 never rerolls and instead counts a 10 as two successes', () => {
		const result = rollPool(4, 6, 'v20', true, createFixedRng(dice));
		expect(result.extraDice).toHaveLength(0);
		expect(result.successes).toBe(2);
	});

	it('with no specialty, both rule sets count a 10 once and never reroll', () => {
		expect(rollPool(4, 6, 'revised', false, createFixedRng(dice)).successes).toBe(1);
		expect(rollPool(4, 6, 'v20', false, createFixedRng(dice)).successes).toBe(1);
	});
});

describe('rollPool, a 10 always succeeds regardless of difficulty', () => {
	it('counts a 10 as a success even at the maximum difficulty of 10', () => {
		const result = rollPool(1, 10, 'v20', false, createFixedRng([10]));
		expect(result.successes).toBe(1);
	});
});
