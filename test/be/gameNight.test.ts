import { describe, it, expect } from 'vitest';
import { downtimePlots, type MyPlot } from '../../src/be/gameNight.js';

function plot(overrides: Partial<MyPlot>): MyPlot {
	return { id: 1, title: 'Plot', is_action_allocation: false, game_date: null, ...overrides };
}

describe('downtimePlots', () => {
	it('keeps only the caller\'s own action-allocation plots', () => {
		const plots = [
			plot({ id: 1, title: 'My Downtime', is_action_allocation: true }),
			plot({ id: 2, title: 'An Open Plot', is_action_allocation: false }),
		];
		expect(downtimePlots(plots).map((p) => p.title)).toEqual(['My Downtime']);
	});

	it('returns an empty list when the player has no allocation plot at all', () => {
		expect(downtimePlots([plot({ is_action_allocation: false })])).toEqual([]);
	});
});
