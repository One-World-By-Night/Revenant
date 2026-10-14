import { describe, it, expect } from 'vitest';
import { matchingCharacters, resolveActiveCharacter, type LinkedCharacter } from '../../src/commands/character.js';

const CHARACTERS: LinkedCharacter[] = [
	{ id: 1, name: 'Isolde Marchetti' },
	{ id: 2, name: 'Konstantin Drake' },
	{ id: 3, name: 'Selene Marchetti-Cole' },
];

describe('matchingCharacters', () => {
	it('matches a case-insensitive substring anywhere in the name', () => {
		expect(matchingCharacters(CHARACTERS, 'march')).toEqual([CHARACTERS[0], CHARACTERS[2]]);
	});

	it('matches everything on an empty query', () => {
		expect(matchingCharacters(CHARACTERS, '')).toEqual(CHARACTERS);
	});

	it('is empty when nothing matches', () => {
		expect(matchingCharacters(CHARACTERS, 'zzz')).toEqual([]);
	});

	it('caps results at 25', () => {
		const many: LinkedCharacter[] = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Character ${i}` }));
		expect(matchingCharacters(many, '')).toHaveLength(25);
	});
});

describe('resolveActiveCharacter', () => {
	it('is none when nothing is set', () => {
		expect(resolveActiveCharacter(CHARACTERS, null)).toEqual({ kind: 'none' });
	});

	it('is active with the matching character when the stored id is still linked', () => {
		expect(resolveActiveCharacter(CHARACTERS, 2)).toEqual({ kind: 'active', character: CHARACTERS[1] });
	});

	it('is cleared when the stored id dropped out of the linked list', () => {
		expect(resolveActiveCharacter(CHARACTERS, 999)).toEqual({ kind: 'cleared' });
	});
});
