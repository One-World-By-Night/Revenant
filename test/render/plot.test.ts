import { describe, it, expect } from 'vitest';
import { buildPlotEmbed, truncateEntryContent } from '../../src/render/plot.js';
import type { PlotWithEntries } from '../../src/be/gameNight.js';

function plot(overrides: Partial<PlotWithEntries>): PlotWithEntries {
	return { id: 1, title: 'A Plot', status: 'active', game_date: null, entries: [], ...overrides };
}

describe('truncateEntryContent', () => {
	it('leaves a short line untouched', () => {
		expect(truncateEntryContent('I watch the docks.')).toBe('I watch the docks.');
	});

	it('cuts a long line to 200 characters with an ellipsis', () => {
		const long = 'x'.repeat(250);
		const result = truncateEntryContent(long);
		expect(result.length).toBe(201);
		expect(result.endsWith('…')).toBe(true);
	});
});

describe('buildPlotEmbed', () => {
	it('shows a placeholder field when the plot has no entries', () => {
		const embed = buildPlotEmbed('en-US', plot({}));
		expect(embed.fields).toHaveLength(1);
		expect(embed.fields?.[0]?.name).toBe('No entries yet.');
	});

	it('lists entries newest first', () => {
		const embed = buildPlotEmbed(
			'en-US',
			plot({
				entries: [
					{ id: 1, entry_type: 'action', content: 'First.', event_date: '2026-09-01', created_at: '2026-09-01 00:00:00' },
					{ id: 2, entry_type: 'scene', content: 'Second.', event_date: '2026-09-02', created_at: '2026-09-02 00:00:00' },
				],
			})
		);
		expect(embed.fields?.[0]?.value).toBe('Second.');
		expect(embed.fields?.[1]?.value).toBe('First.');
	});

	it('caps the shown entries and notes how many more exist', () => {
		const entries = Array.from({ length: 10 }, (_, i) => ({
			id: i,
			entry_type: 'action',
			content: `Entry ${i}`,
			event_date: '2026-09-01',
			created_at: '2026-09-01 00:00:00',
		}));
		const embed = buildPlotEmbed('en-US', plot({ entries }));
		expect(embed.fields).toHaveLength(9);
		expect(embed.fields?.[8]?.value).toContain('2');
	});

	it('includes the game date when the plot has one', () => {
		const embed = buildPlotEmbed('en-US', plot({ game_date: '2026-09-01' }));
		expect(embed.description).toBe('Game date: 2026-09-01');
	});

	it('omits a description when the plot has no game date', () => {
		const embed = buildPlotEmbed('en-US', plot({ game_date: null }));
		expect(embed.description).toBeUndefined();
	});
});
