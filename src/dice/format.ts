import type { RollResult, TermResult, DieResult } from './roll.js';
import type { PoolResult, PoolDie } from './pools.js';

function formatDie(die: DieResult): string {
	const text = die.exploded ? `${die.value}!` : String(die.value);
	return die.kept ? text : `~~${text}~~`;
}

function formatTerm(term: TermResult, isFirst: boolean): string {
	const sign = term.sign === -1 ? '-' : isFirst ? '' : '+';
	const body = term.flatValue !== undefined ? String(term.flatValue) : term.dice.map(formatDie).join(' + ');
	const wrapped = term.dice.length > 1 ? `(${body})` : body;
	return isFirst ? `${sign}${wrapped}` : ` ${sign} ${wrapped}`;
}

/**
 * Renders a general-notation roll as every die, struck through when not kept and marked `!` when it
 * triggered an explosion, followed by the total.
 */
export function formatNotationResult(result: RollResult): string {
	const parts = result.terms.map((term, index) => formatTerm(term, index === 0));
	return `${parts.join('')} = **${result.total}**`;
}

function formatPoolDie(die: PoolDie, difficulty: number): string {
	return die.value >= difficulty ? `**${die.value}**` : String(die.value);
}

function formatPoolDice(dice: PoolDie[], difficulty: number): string {
	return dice.map((die) => formatPoolDie(die, difficulty)).join(', ');
}

/**
 * Renders a World of Darkness pool roll as every die (successes bolded), its extra dice shown
 * separately when a specialty rerolled any, and the successes or "Botch"/"Failure".
 */
export function formatPoolResult(result: PoolResult): string {
	const base = formatPoolDice(result.dice, result.difficulty);
	const extra = result.extraDice.length > 0 ? ` (extra: ${formatPoolDice(result.extraDice, result.difficulty)})` : '';
	const outcomeText =
		result.outcome === 'botch'
			? 'Botch'
			: result.outcome === 'failure'
				? 'Failure'
				: `${result.successes} success${result.successes === 1 ? '' : 'es'}`;
	return `${base}${extra} — **${outcomeText}**`;
}
