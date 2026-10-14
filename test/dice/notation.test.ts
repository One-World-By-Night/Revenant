import { describe, it, expect } from 'vitest';
import { parseNotation } from '../../src/dice/notation.js';

describe('parseNotation, accepted forms', () => {
	it('parses a simple dice-plus-number expression', () => {
		const result = parseNotation('2d6+3');
		expect(result).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'dice', sign: 1, count: 2, sides: 6 }, { kind: 'number', sign: 1, value: 3 }] },
		});
	});

	it('defaults the count to 1 and reads % as 100 sides', () => {
		const result = parseNotation('d100');
		expect(result).toEqual({ ok: true, notation: { terms: [{ kind: 'dice', sign: 1, count: 1, sides: 100 }] } });
		expect(parseNotation('d%')).toEqual(result);
	});

	it('parses keep-highest and keep-lowest', () => {
		expect(parseNotation('4d6kh3')).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'dice', sign: 1, count: 4, sides: 6, keep: { mode: 'highest', count: 3 } }] },
		});
		expect(parseNotation('4d6kl1')).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'dice', sign: 1, count: 4, sides: 6, keep: { mode: 'lowest', count: 1 } }] },
		});
	});

	it('joins multiple terms with + and -, with spaces anywhere and any case', () => {
		const result = parseNotation('1D20 + 1d4 - 2');
		expect(result).toEqual({
			ok: true,
			notation: {
				terms: [
					{ kind: 'dice', sign: 1, count: 1, sides: 20 },
					{ kind: 'dice', sign: 1, count: 1, sides: 4 },
					{ kind: 'number', sign: -1, value: 2 },
				],
			},
		});
	});

	it('accepts a leading minus on the first term', () => {
		expect(parseNotation('-2+1d6')).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'number', sign: -1, value: 2 }, { kind: 'dice', sign: 1, count: 1, sides: 6 }] },
		});
	});

	it('parses drop-highest and drop-lowest as the equivalent keep', () => {
		expect(parseNotation('4d6dl1')).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'dice', sign: 1, count: 4, sides: 6, keep: { mode: 'highest', count: 3 } }] },
		});
		expect(parseNotation('4d6dh1')).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'dice', sign: 1, count: 4, sides: 6, keep: { mode: 'lowest', count: 3 } }] },
		});
	});

	it('parses an exploding term, with or without a keep modifier', () => {
		expect(parseNotation('4d6!')).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'dice', sign: 1, count: 4, sides: 6, exploding: true }] },
		});
		expect(parseNotation('4d6!kh3')).toEqual({
			ok: true,
			notation: { terms: [{ kind: 'dice', sign: 1, count: 4, sides: 6, exploding: true, keep: { mode: 'highest', count: 3 } }] },
		});
	});
});

describe('parseNotation, refused forms', () => {
	it('refuses an empty expression', () => {
		expect(parseNotation('')).toEqual({ ok: false, error: expect.any(String) });
		expect(parseNotation('   ')).toEqual({ ok: false, error: expect.any(String) });
	});

	it('refuses garbage with a message naming the whole input', () => {
		const result = parseNotation('2d6+banana');
		expect(result.ok).toBe(false);
		expect((result as { error: string }).error).toContain('2d6+banana');
	});

	it('refuses a dice count out of range', () => {
		expect(parseNotation('101d6').ok).toBe(false);
		expect(parseNotation('0d6').ok).toBe(false);
	});

	it('refuses sides out of range', () => {
		expect(parseNotation('1d1').ok).toBe(false);
		expect(parseNotation('1d1001').ok).toBe(false);
	});

	it('refuses keeping more dice than were rolled', () => {
		const result = parseNotation('2d6kh3');
		expect(result.ok).toBe(false);
		expect((result as { error: string }).error).toContain("only 2 dice");
	});

	it('refuses dropping as many or more dice than were rolled', () => {
		expect(parseNotation('3d6dl3').ok).toBe(false);
		expect(parseNotation('3d6dl4').ok).toBe(false);
	});

	it('refuses dropping zero dice', () => {
		expect(parseNotation('3d6dl0').ok).toBe(false);
	});

	it('refuses more than 20 terms', () => {
		const expr = Array.from({ length: 21 }, () => '1').join('+');
		const result = parseNotation(expr);
		expect(result.ok).toBe(false);
		expect((result as { error: string }).error).toContain('21 terms');
	});

	it('refuses more than 100 dice total across terms', () => {
		const result = parseNotation('60d6+60d6');
		expect(result.ok).toBe(false);
		expect((result as { error: string }).error).toContain('120 dice');
	});
});
