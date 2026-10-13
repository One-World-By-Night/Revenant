import { describe, it, expect } from 'vitest';
import { classifyDisconnectOutcome } from '../../src/commands/disconnect.js';
import { BeApiError } from '../../src/be/client.js';

describe('classifyDisconnectOutcome', () => {
	it('is success when nothing was thrown', () => {
		expect(classifyDisconnectOutcome(null)).toBe('success');
	});

	it('is endedFromSite for an auth_failed error', () => {
		expect(classifyDisconnectOutcome(new BeApiError('auth_failed', 401, 'bot_auth_failed', null))).toBe(
			'endedFromSite'
		);
	});

	it('is successWithNote for an unreachable error', () => {
		expect(classifyDisconnectOutcome(new BeApiError('unreachable', null, null, null))).toBe('successWithNote');
	});

	it('is successWithNote for any other BE error', () => {
		expect(classifyDisconnectOutcome(new BeApiError('route_error', 500, 'internal_error', null))).toBe(
			'successWithNote'
		);
	});

	it('is successWithNote for a plain network error', () => {
		expect(classifyDisconnectOutcome(new Error('ECONNRESET'))).toBe('successWithNote');
	});
});
