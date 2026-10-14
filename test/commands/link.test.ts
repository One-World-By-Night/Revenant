import { describe, it, expect } from 'vitest';
import { formatExpiry, shouldPingStaff } from '../../src/commands/link.js';

describe('formatExpiry', () => {
	it('renders a Discord relative timestamp from an ISO instant', () => {
		expect(formatExpiry('2026-10-13T18:30:00+00:00')).toBe('<t:1791916200:R>');
	});

	it('renders the same instant regardless of the offset it arrives in', () => {
		expect(formatExpiry('2026-10-13T14:30:00-04:00')).toBe('<t:1791916200:R>');
	});
});

describe('shouldPingStaff', () => {
	const now = new Date('2026-10-13T18:30:00Z');

	it('is true when the staff channel has never heard about this request', () => {
		expect(shouldPingStaff(null, now)).toBe(true);
	});

	it('is false within the same hour as the last ping', () => {
		const lastPingAt = new Date('2026-10-13T18:00:00Z');
		expect(shouldPingStaff(lastPingAt, now)).toBe(false);
	});

	it('is true once over an hour has passed since the last ping', () => {
		const lastPingAt = new Date('2026-10-13T17:29:59Z');
		expect(shouldPingStaff(lastPingAt, now)).toBe(true);
	});
});
