import { describe, it, expect } from 'vitest';
import { isLinkedCharacter, clampPageIndex } from '../../src/commands/sheet.js';

describe('isLinkedCharacter', () => {
	const characters = [
		{ id: 1, name: 'Isolde Marchetti' },
		{ id: 2, name: 'Konstantin Drake' },
	];

	it('is true for a linked character id', () => {
		expect(isLinkedCharacter(characters, 2)).toBe(true);
	});

	it('is false for an id not in the list', () => {
		expect(isLinkedCharacter(characters, 999)).toBe(false);
	});

	it('is false for an empty list', () => {
		expect(isLinkedCharacter([], 1)).toBe(false);
	});
});

describe('clampPageIndex', () => {
	it('moves forward within range', () => {
		expect(clampPageIndex(0, 1, 3)).toBe(1);
	});

	it('moves backward within range', () => {
		expect(clampPageIndex(2, -1, 3)).toBe(1);
	});

	it('does not go past the last page', () => {
		expect(clampPageIndex(2, 1, 3)).toBe(2);
	});

	it('does not go before the first page', () => {
		expect(clampPageIndex(0, -1, 3)).toBe(0);
	});

	it('clamps to zero for a single-page or empty list', () => {
		expect(clampPageIndex(0, 1, 1)).toBe(0);
		expect(clampPageIndex(0, 1, 0)).toBe(0);
	});
});
