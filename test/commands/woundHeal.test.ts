import { describe, it, expect } from 'vitest';
import { foldArmorIntoReason, formatWoundReply } from '../../src/commands/woundHeal.js';

describe('foldArmorIntoReason', () => {
	it('passes a reason through unchanged when no armor is given', () => {
		expect(foldArmorIntoReason(null, 'Shot in the alley')).toBe('Shot in the alley');
	});

	it('passes a reason through unchanged when armor is zero or negative', () => {
		expect(foldArmorIntoReason(0, 'Shot in the alley')).toBe('Shot in the alley');
	});

	it('folds a positive armor amount in front of the reason', () => {
		expect(foldArmorIntoReason(4, 'Shot in the alley')).toBe('4 to armor. Shot in the alley');
	});

	it('states the armor amount alone when no reason is given', () => {
		expect(foldArmorIntoReason(4, '')).toBe('4 to armor.');
	});
});

describe('formatWoundReply', () => {
	it('lists all three wound types', () => {
		expect(formatWoundReply('en-US', { bashing: 2, lethal: 4, aggravated: 0 })).toBe(
			'**Bashing:** 2\n**Lethal:** 4\n**Aggravated:** 0'
		);
	});

	it('renders in Portuguese when asked', () => {
		expect(formatWoundReply('pt-BR', { bashing: 2, lethal: 4, aggravated: 0 })).toBe(
			'**Contundente:** 2\n**Letal:** 4\n**Agravado:** 0'
		);
	});
});
