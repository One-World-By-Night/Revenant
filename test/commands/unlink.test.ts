import { describe, it, expect } from 'vitest';
import { classifyUnlinkOutcome } from '../../src/commands/unlink.js';
import { BeApiError } from '../../src/be/client.js';

describe('classifyUnlinkOutcome', () => {
	it('is success when nothing was thrown', () => {
		expect(classifyUnlinkOutcome(null)).toBe('success');
	});

	it('is notLinked when the Discord user holds no active link', () => {
		expect(classifyUnlinkOutcome(new BeApiError('user_not_linked', 403, 'bot_user_not_linked', null))).toBe('notLinked');
	});

	it('is error for any other BE error', () => {
		expect(classifyUnlinkOutcome(new BeApiError('unreachable', null, null, null))).toBe('error');
	});

	it('is error for a plain network error', () => {
		expect(classifyUnlinkOutcome(new Error('ECONNRESET'))).toBe('error');
	});
});
