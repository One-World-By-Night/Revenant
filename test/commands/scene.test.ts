import { describe, it, expect } from 'vitest';
import { formatSceneLines } from '../../src/commands/scene.js';

describe('formatSceneLines', () => {
	it('credits a proxied line to its character with no OOC marker', () => {
		expect(formatSceneLines([{ speaker: 'Corwin Ashe', content: 'I watch the docks.', inCharacter: true }])).toBe(
			'Corwin Ashe: I watch the docks.'
		);
	});

	it('marks an unproxied line out of character', () => {
		expect(formatSceneLines([{ speaker: 'playerOne', content: 'brb', inCharacter: false }])).toBe('playerOne (OOC): brb');
	});

	it('keeps several lines in the given order, one per line', () => {
		const rendered = formatSceneLines([
			{ speaker: 'Corwin Ashe', content: 'Hello.', inCharacter: true },
			{ speaker: 'playerOne', content: 'brb', inCharacter: false },
			{ speaker: 'Isolde Marchetti', content: 'Good evening.', inCharacter: true },
		]);
		expect(rendered).toBe('Corwin Ashe: Hello.\nplayerOne (OOC): brb\nIsolde Marchetti: Good evening.');
	});
});
