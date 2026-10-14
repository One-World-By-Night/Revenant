import { randomInt } from 'node:crypto';

export type Rng = (sides: number) => number;

/**
 * Rolls one die of the given number of sides, 1 through `sides` inclusive, from `crypto.randomInt`.
 */
export function createRng(): Rng {
	return (sides: number) => randomInt(1, sides + 1);
}

/**
 * An `Rng` that returns a fixed sequence of values in order, for deterministic tests. Throws once the
 * sequence runs out, rather than silently wrapping, so an undercounted test fails loudly.
 */
export function createFixedRng(sequence: number[]): Rng {
	let index = 0;
	return () => {
		if (index >= sequence.length) {
			throw new Error('fixed RNG sequence exhausted');
		}
		const value = sequence[index] as number;
		index += 1;
		return value;
	};
}
