import { describe, it, expect } from 'vitest';
import { roleForCapabilities } from '../../src/be/rooms.js';

describe('roleForCapabilities', () => {
	it('gives the Storyteller role to anyone managing characters', () => {
		expect(roleForCapabilities({ be_manage_characters: true, be_manage_plots: true })).toBe('storyteller');
		expect(roleForCapabilities({ be_manage_characters: true, be_manage_plots: false })).toBe('storyteller');
	});

	it('gives the Narrator role to a plot manager who does not manage characters', () => {
		expect(roleForCapabilities({ be_manage_characters: false, be_manage_plots: true })).toBe('narrator');
	});

	it('gives the plain Player role to everyone else', () => {
		expect(roleForCapabilities({ be_manage_characters: false, be_manage_plots: false })).toBe('player');
	});
});
