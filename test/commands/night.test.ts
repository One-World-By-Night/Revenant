import { describe, it, expect } from 'vitest';
import { todayUtcDate } from '../../src/commands/night.js';

describe('todayUtcDate', () => {
	it('formats a date as YYYY-MM-DD in UTC', () => {
		expect(todayUtcDate(new Date('2026-10-15T23:30:00Z'))).toBe('2026-10-15');
	});

	it('does not shift across a UTC day boundary', () => {
		expect(todayUtcDate(new Date('2026-01-01T00:05:00Z'))).toBe('2026-01-01');
	});
});
