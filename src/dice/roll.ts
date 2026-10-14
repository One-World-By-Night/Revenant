import type { Rng } from './rng.js';
import type { DiceTerm, NotationTerm, NumberTerm, ParsedNotation } from './notation.js';

export interface DieResult {
	sides: number;
	value: number;
	kept: boolean;
}

export interface TermResult {
	sign: 1 | -1;
	dice: DieResult[];
	flatValue?: number;
}

export interface RollResult {
	terms: TermResult[];
	total: number;
}

function rollDiceTerm(term: DiceTerm, rng: Rng): TermResult {
	const values = Array.from({ length: term.count }, () => rng(term.sides));

	let keptIndices: Set<number>;
	if (term.keep) {
		const { mode, count } = term.keep;
		const ordered = values
			.map((value, index) => ({ value, index }))
			.sort((a, b) => (mode === 'highest' ? b.value - a.value : a.value - b.value) || a.index - b.index);
		keptIndices = new Set(ordered.slice(0, count).map((entry) => entry.index));
	} else {
		keptIndices = new Set(values.map((_, index) => index));
	}

	const dice: DieResult[] = values.map((value, index) => ({ sides: term.sides, value, kept: keptIndices.has(index) }));
	return { sign: term.sign, dice };
}

function rollNumberTerm(term: NumberTerm): TermResult {
	return { sign: term.sign, dice: [], flatValue: term.value };
}

function termValue(term: TermResult): number {
	return term.flatValue ?? term.dice.filter((die) => die.kept).reduce((sum, die) => sum + die.value, 0);
}

/**
 * Executes a parsed notation expression, rolling every dice term through `rng` and summing kept dice
 * and flat numbers by each term's sign.
 */
export function rollNotation(parsed: ParsedNotation, rng: Rng): RollResult {
	const terms = parsed.terms.map((term: NotationTerm) => (term.kind === 'dice' ? rollDiceTerm(term, rng) : rollNumberTerm(term)));
	const total = terms.reduce((sum, term) => sum + term.sign * termValue(term), 0);
	return { terms, total };
}
