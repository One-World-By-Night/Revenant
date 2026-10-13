import { describe, it, expect } from 'vitest';
import { normalizeConnectCode, classifyConnectFailure } from '../../src/commands/connect.js';
import { BeApiError } from '../../src/be/client.js';

describe('normalizeConnectCode', () => {
	it('upper-cases a lower-case code', () => {
		expect(normalizeConnectCode('ab3fgk2m7x9q')).toBe('AB3FGK2M7X9Q');
	});

	it('drops dashes', () => {
		expect(normalizeConnectCode('AB3F-GK2M-7X9Q')).toBe('AB3FGK2M7X9Q');
	});

	it('drops spaces', () => {
		expect(normalizeConnectCode('AB3F GK2M 7X9Q')).toBe('AB3FGK2M7X9Q');
	});

	it('drops a mix of spaces and dashes', () => {
		expect(normalizeConnectCode(' ab3f - gk2m 7x9q ')).toBe('AB3FGK2M7X9Q');
	});
});

describe('classifyConnectFailure', () => {
	it('classifies invalid_code', () => {
		expect(classifyConnectFailure(new BeApiError('route_error', 400, 'invalid_code', null))).toBe('connect.invalidCode');
	});

	it('classifies already_connected', () => {
		expect(classifyConnectFailure(new BeApiError('route_error', 409, 'already_connected', null))).toBe(
			'connect.alreadyConnected'
		);
	});

	it('classifies a 404 as too old', () => {
		expect(classifyConnectFailure(new BeApiError('route_error', 404, 'rest_no_route', null))).toBe('connect.tooOld');
	});

	it('classifies anything else as unreachable', () => {
		expect(classifyConnectFailure(new BeApiError('unreachable', null, null, null))).toBe('connect.unreachable');
	});

	it('classifies a plain network error as unreachable', () => {
		expect(classifyConnectFailure(new Error('ECONNRESET'))).toBe('connect.unreachable');
	});

	it('classifies a non-Error thrown value as unreachable', () => {
		expect(classifyConnectFailure('not even an error')).toBe('connect.unreachable');
	});
});
