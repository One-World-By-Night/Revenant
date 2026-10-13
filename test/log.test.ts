import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../src/log.js';

function capture(): { logger: ReturnType<typeof createLogger>; firstLine: () => Record<string, unknown> } {
	const chunks: string[] = [];
	const destination = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	});
	const logger = createLogger('debug', destination);
	return {
		logger,
		firstLine: () => {
			const lines = chunks.join('').split('\n').filter(Boolean);
			const first = lines[0];
			if (first === undefined) {
				throw new Error('expected at least one logged line');
			}
			return JSON.parse(first) as Record<string, unknown>;
		},
	};
}

describe('createLogger redaction', () => {
	it('redacts a top-level token', () => {
		const { logger, firstLine } = capture();
		logger.info({ token: 'super-secret-token' }, 'logged in');
		expect(firstLine().token).toBe('[redacted]');
	});

	it('redacts a top-level secret, secretKey and code', () => {
		const { logger, firstLine } = capture();
		logger.info({ secret: 'a', secretKey: 'b', code: 'c' }, 'event');
		const entry = firstLine();
		expect(entry.secret).toBe('[redacted]');
		expect(entry.secretKey).toBe('[redacted]');
		expect(entry.code).toBe('[redacted]');
	});

	it('redacts a confirm link', () => {
		const { logger, firstLine } = capture();
		logger.info({ confirmUrl: 'https://example.test/confirm?token=abc' }, 'link sent');
		expect(firstLine().confirmUrl).toBe('[redacted]');
	});

	it('redacts a nested token one level down', () => {
		const { logger, firstLine } = capture();
		logger.info({ request: { token: 'nested-secret' } }, 'call made');
		const entry = firstLine() as { request: Record<string, unknown> };
		expect(entry.request.token).toBe('[redacted]');
	});

	it('leaves an ordinary field untouched', () => {
		const { logger, firstLine } = capture();
		logger.info({ guildId: '123', command: 'connect' }, 'command run');
		const entry = firstLine();
		expect(entry.guildId).toBe('123');
		expect(entry.command).toBe('connect');
	});
});
