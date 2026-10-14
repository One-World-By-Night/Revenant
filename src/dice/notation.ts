export interface DiceTerm {
	kind: 'dice';
	sign: 1 | -1;
	count: number;
	sides: number;
	keep?: { mode: 'highest' | 'lowest'; count: number };
}

export interface NumberTerm {
	kind: 'number';
	sign: 1 | -1;
	value: number;
}

export type NotationTerm = DiceTerm | NumberTerm;

export interface ParsedNotation {
	terms: NotationTerm[];
}

export type ParseResult = { ok: true; notation: ParsedNotation } | { ok: false; error: string };

const MAX_TERMS = 20;
const MAX_TOTAL_DICE = 100;
const MIN_COUNT = 1;
const MAX_COUNT = 100;
const MIN_SIDES = 2;
const MAX_SIDES = 1000;

const TOKEN_PATTERN = /([+-])(\d*d(?:\d+|%)(?:k[hl]\d+)?|\d+)/g;
const DICE_BODY_PATTERN = /^(\d*)d(\d+|%)(?:(kh|kl)(\d+))?$/;

/**
 * Parses general dice notation - `2d6+3`, `d100`, `4d6kh3`, `1d20 + 1d4 - 2` - case-insensitive and
 * with spaces anywhere, into terms ready for `rollNotation`. Refuses anything outside this project's
 * stated limits with a message naming the specific problem.
 */
export function parseNotation(raw: string): ParseResult {
	const compact = raw.replace(/\s+/g, '').toLowerCase();
	if (compact === '') {
		return { ok: false, error: 'enter a dice expression, like 2d6+3' };
	}
	const signed = /^[+-]/.test(compact) ? compact : `+${compact}`;

	const terms: NotationTerm[] = [];
	let consumedLength = 0;
	let totalDice = 0;

	for (const match of signed.matchAll(TOKEN_PATTERN)) {
		if (match.index !== consumedLength) {
			return { ok: false, error: `couldn't read "${raw}" as dice notation` };
		}
		consumedLength += match[0].length;

		const sign: 1 | -1 = match[1] === '-' ? -1 : 1;
		const body = match[2] as string;

		if (body.includes('d')) {
			const diceMatch = DICE_BODY_PATTERN.exec(body);
			if (!diceMatch) {
				return { ok: false, error: `couldn't read "${body}" as a dice term` };
			}
			const countText = diceMatch[1] as string;
			const sidesText = diceMatch[2] as string;
			const count = countText === '' ? 1 : Number(countText);
			const sides = sidesText === '%' ? 100 : Number(sidesText);

			if (count < MIN_COUNT || count > MAX_COUNT) {
				return { ok: false, error: `a dice term's count must be ${MIN_COUNT} to ${MAX_COUNT}, got ${count}` };
			}
			if (sides < MIN_SIDES || sides > MAX_SIDES) {
				return { ok: false, error: `a die's sides must be ${MIN_SIDES} to ${MAX_SIDES}, got ${sides}` };
			}

			let keep: DiceTerm['keep'];
			const keepMode = diceMatch[3];
			if (keepMode) {
				const keepCount = Number(diceMatch[4]);
				if (keepCount < 1 || keepCount > count) {
					return { ok: false, error: `can't keep ${keepCount} of only ${count} dice` };
				}
				keep = { mode: keepMode === 'kh' ? 'highest' : 'lowest', count: keepCount };
			}

			totalDice += count;
			terms.push({ kind: 'dice', sign, count, sides, ...(keep ? { keep } : {}) });
		} else {
			terms.push({ kind: 'number', sign, value: Number(body) });
		}
	}

	if (consumedLength !== signed.length) {
		return { ok: false, error: `couldn't read "${raw}" as dice notation` };
	}
	if (terms.length === 0) {
		return { ok: false, error: 'enter a dice expression, like 2d6+3' };
	}
	if (terms.length > MAX_TERMS) {
		return { ok: false, error: `that's ${terms.length} terms; the limit is ${MAX_TERMS}` };
	}
	if (totalDice > MAX_TOTAL_DICE) {
		return { ok: false, error: `that's ${totalDice} dice; the limit is ${MAX_TOTAL_DICE}` };
	}

	return { ok: true, notation: { terms } };
}
