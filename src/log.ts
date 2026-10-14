import { pino } from 'pino';
import type { LogLevel } from './config.js';

const REDACT_PATHS = [
	'token',
	'secret',
	'secretKey',
	'secret_key',
	'code',
	'discordToken',
	'confirmUrl',
	'confirm_url',
	'*.token',
	'*.secret',
	'*.secretKey',
	'*.secret_key',
	'*.code',
	'*.discordToken',
	'*.confirmUrl',
	'*.confirm_url',
];

/**
 * Builds the bot's logger: JSON lines on stdout, with every field that could hold a secret, token,
 * connect code or confirm link replaced before it is ever written. A destination other than stdout may
 * be given, for tests.
 */
export function createLogger(level: LogLevel, destination?: pino.DestinationStream) {
	const options: pino.LoggerOptions = {
		level,
		redact: {
			paths: REDACT_PATHS,
			censor: '[redacted]',
		},
		timestamp: pino.stdTimeFunctions.isoTime,
	};
	return destination ? pino(options, destination) : pino(options);
}

export type Logger = ReturnType<typeof createLogger>;
