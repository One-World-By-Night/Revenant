import { describe, it, expect } from 'vitest';
import { classifyRollRequest } from '../../src/commands/roll.js';

describe('classifyRollRequest', () => {
	it('is dice when only dice is given', () => {
		expect(classifyRollRequest('2d6', null)).toBe('dice');
	});

	it('is pool when only pool is given', () => {
		expect(classifyRollRequest(null, 6)).toBe('pool');
	});

	it('is both when both are given', () => {
		expect(classifyRollRequest('2d6', 6)).toBe('both');
	});

	it('is neither when neither is given', () => {
		expect(classifyRollRequest(null, null)).toBe('neither');
	});
});
