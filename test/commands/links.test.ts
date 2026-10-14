import { describe, it, expect } from 'vitest';
import { parseLinksButtonId, renderLinksList, type LinkRow } from '../../src/commands/links.js';

describe('parseLinksButtonId', () => {
	it('parses an approve button id', () => {
		expect(parseLinksButtonId('links:approve:42')).toEqual({ action: 'approve', linkId: 42 });
	});

	it('parses a decline button id', () => {
		expect(parseLinksButtonId('links:decline:7')).toEqual({ action: 'decline', linkId: 7 });
	});

	it('parses a revoke button id', () => {
		expect(parseLinksButtonId('links:revoke:7')).toEqual({ action: 'revoke', linkId: 7 });
	});

	it('is null for an unrelated custom id', () => {
		expect(parseLinksButtonId('disconnect:confirm')).toBeNull();
	});

	it('is null for an unknown action', () => {
		expect(parseLinksButtonId('links:delete:7')).toBeNull();
	});
});

describe('renderLinksList', () => {
	const sample: LinkRow[] = [
		{ id: 1, discord_username: 'Player One', characters: [{ id: 10, name: 'Isolde' }] },
		{ id: 2, discord_username: 'Player Two', characters: [] },
	];

	it('shows the empty message for a confirmed view with nothing waiting', () => {
		const view = renderLinksList('en-US', 'confirmed', []);
		expect(view.content).toBe('No requests are waiting for an answer.');
		expect(view.components).toHaveLength(0);
	});

	it('shows the empty message for an approved view with nothing approved', () => {
		const view = renderLinksList('en-US', 'approved', []);
		expect(view.content).toBe('No links are approved yet.');
	});

	it('renders one row with Approve and Decline per confirmed link', () => {
		const view = renderLinksList('en-US', 'confirmed', sample);
		expect(view.content).toContain('**Player One** (Isolde)');
		expect(view.content).toContain('**Player Two** (—)');
		expect(view.components).toHaveLength(2);
		expect(view.components[0]?.components).toHaveLength(2);
	});

	it('renders one Revoke button per approved link', () => {
		const view = renderLinksList('en-US', 'approved', sample);
		expect(view.components).toHaveLength(2);
		expect(view.components[0]?.components).toHaveLength(1);
	});

	it('caps the shown rows and notes how many more there are', () => {
		const many: LinkRow[] = Array.from({ length: 7 }, (_, i) => ({ id: i, discord_username: `P${i}`, characters: [] }));
		const view = renderLinksList('en-US', 'confirmed', many);
		expect(view.components).toHaveLength(5);
		expect(view.content).toContain('+2');
	});
});
