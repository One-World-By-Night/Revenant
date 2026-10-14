import type { Rng } from './rng.js';

export type PoolRules = 'revised' | 'v20';
export type PoolOutcome = 'botch' | 'failure' | 'success';

export interface PoolDie {
	value: number;
}

export interface PoolResult {
	rules: PoolRules;
	difficulty: number;
	specialty: boolean;
	dice: PoolDie[];
	extraDice: PoolDie[];
	successes: number;
	outcome: PoolOutcome;
}

export const MIN_POOL = 1;
export const MAX_POOL = 30;
export const MIN_DIFFICULTY = 2;
export const MAX_DIFFICULTY = 10;
export const DEFAULT_DIFFICULTY = 6;

export type PoolValidation = { ok: true } | { ok: false; error: string };

/**
 * Checks a pool size and difficulty against this project's stated World of Darkness pool limits,
 * naming the specific problem when either is out of range.
 */
export function validatePool(poolSize: number, difficulty: number): PoolValidation {
	if (!Number.isInteger(poolSize) || poolSize < MIN_POOL || poolSize > MAX_POOL) {
		return { ok: false, error: `the pool must be ${MIN_POOL} to ${MAX_POOL} dice, got ${poolSize}` };
	}
	if (!Number.isInteger(difficulty) || difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY) {
		return { ok: false, error: `the difficulty must be ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}, got ${difficulty}` };
	}
	return { ok: true };
}

function isSuccessDie(value: number, difficulty: number): boolean {
	return value >= difficulty;
}

/**
 * Rolls one World of Darkness dice pool, per the shared rule both Revised and V20 state identically
 * (p. 192 and p. 249-250 of their own core books): each die at or above the difficulty is a success,
 * each 1 cancels one success, and a roll with no raw successes and at least one 1 is a botch - even
 * when a raw success was scored and fully canceled out, it stays a simple failure, never a botch.
 * Specialty differs exactly one way between the rule sets: Revised (p. 117) rerolls every 10, cascading
 * while the reroll keeps coming up 10, each extra die judged the same way as the pool's own dice; V20
 * (p. 96) rerolls nothing and instead counts every 10 as two successes.
 */
export function rollPool(poolSize: number, difficulty: number, rules: PoolRules, specialty: boolean, rng: Rng): PoolResult {
	const dice: PoolDie[] = Array.from({ length: poolSize }, () => ({ value: rng(10) }));
	const extraDice: PoolDie[] = [];

	if (rules === 'revised' && specialty) {
		let pendingTens = dice.filter((die) => die.value === 10).length;
		while (pendingTens > 0) {
			const rerolled: PoolDie[] = Array.from({ length: pendingTens }, () => ({ value: rng(10) }));
			extraDice.push(...rerolled);
			pendingTens = rerolled.filter((die) => die.value === 10).length;
		}
	}

	const allDice = [...dice, ...extraDice];
	const rawSuccesses =
		rules === 'v20' && specialty
			? allDice.reduce((sum, die) => sum + (die.value === 10 ? 2 : isSuccessDie(die.value, difficulty) ? 1 : 0), 0)
			: allDice.filter((die) => isSuccessDie(die.value, difficulty)).length;
	const ones = allDice.filter((die) => die.value === 1).length;
	const successes = Math.max(0, rawSuccesses - ones);

	const outcome: PoolOutcome = rawSuccesses === 0 && ones > 0 ? 'botch' : successes === 0 ? 'failure' : 'success';

	return { rules, difficulty, specialty, dice, extraDice, successes, outcome };
}
