import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const GOOD_KEY = Buffer.alloc(32, 7).toString('base64');

function baseEnv(): NodeJS.ProcessEnv {
	return {
		DISCORD_TOKEN: 'token-123',
		DISCORD_APPLICATION_ID: 'app-456',
		DATABASE_URL: 'postgres://localhost/test',
		SECRET_KEY: GOOD_KEY,
	};
}

describe('loadConfig', () => {
	it('reads required values and applies defaults', () => {
		const config = loadConfig(baseEnv());
		expect(config.discordToken).toBe('token-123');
		expect(config.discordApplicationId).toBe('app-456');
		expect(config.databaseUrl).toBe('postgres://localhost/test');
		expect(config.secretKey).toEqual(Buffer.alloc(32, 7));
		expect(config.botDisplayName).toBe('Revenant');
		expect(config.defaultLocale).toBe('en-US');
		expect(config.logLevel).toBe('info');
		expect(config.healthPort).toBe(8080);
		expect(config.devGuildId).toBeUndefined();
		expect(config.allowInsecureLocalhost).toBe(false);
		expect(config.eventPollSeconds).toBeUndefined();
	});

	it('reads every optional value when set', () => {
		const config = loadConfig({
			...baseEnv(),
			BOT_DISPLAY_NAME: 'Test Bot',
			DEFAULT_LOCALE: 'pt-BR',
			LOG_LEVEL: 'debug',
			HEALTH_PORT: '9090',
			DEV_GUILD_ID: 'guild-1',
			ALLOW_INSECURE_LOCALHOST: 'true',
			EVENT_POLL_SECONDS: '30',
		});
		expect(config.botDisplayName).toBe('Test Bot');
		expect(config.defaultLocale).toBe('pt-BR');
		expect(config.logLevel).toBe('debug');
		expect(config.healthPort).toBe(9090);
		expect(config.devGuildId).toBe('guild-1');
		expect(config.allowInsecureLocalhost).toBe(true);
		expect(config.eventPollSeconds).toBe(30);
	});

	it.each(['1', 'TRUE', 'True'])('accepts %s as a true boolean', (value) => {
		const config = loadConfig({ ...baseEnv(), ALLOW_INSECURE_LOCALHOST: value });
		expect(config.allowInsecureLocalhost).toBe(true);
	});

	it.each(['0', 'FALSE', 'False'])('accepts %s as a false boolean', (value) => {
		const config = loadConfig({ ...baseEnv(), ALLOW_INSECURE_LOCALHOST: value });
		expect(config.allowInsecureLocalhost).toBe(false);
	});

	it('names every missing required value in one error', () => {
		expect(() => loadConfig({})).toThrowError(
			/DISCORD_TOKEN is required.*DISCORD_APPLICATION_ID is required.*DATABASE_URL is required.*SECRET_KEY is required/s
		);
	});

	it('refuses a secret key of the wrong length', () => {
		const shortKey = Buffer.alloc(16, 1).toString('base64');
		expect(() => loadConfig({ ...baseEnv(), SECRET_KEY: shortKey })).toThrowError(/32 bytes, got 16/);
	});

	it('refuses an invalid locale', () => {
		expect(() => loadConfig({ ...baseEnv(), DEFAULT_LOCALE: 'fr-FR' })).toThrowError(
			/DEFAULT_LOCALE must be one of en-US, pt-BR/
		);
	});

	it('refuses an invalid log level', () => {
		expect(() => loadConfig({ ...baseEnv(), LOG_LEVEL: 'verbose' })).toThrowError(
			/LOG_LEVEL must be one of debug, info, warn, error/
		);
	});

	it('refuses an out-of-range health port', () => {
		expect(() => loadConfig({ ...baseEnv(), HEALTH_PORT: '99999' })).toThrowError(
			/HEALTH_PORT must be a port number from 1 to 65535/
		);
	});

	it('refuses a non-numeric health port', () => {
		expect(() => loadConfig({ ...baseEnv(), HEALTH_PORT: 'abc' })).toThrowError(/HEALTH_PORT must be a port number/);
	});

	it('refuses an invalid boolean', () => {
		expect(() => loadConfig({ ...baseEnv(), ALLOW_INSECURE_LOCALHOST: 'yes' })).toThrowError(
			/ALLOW_INSECURE_LOCALHOST must be true or false/
		);
	});

	it('refuses a non-positive event poll interval', () => {
		expect(() => loadConfig({ ...baseEnv(), EVENT_POLL_SECONDS: '0' })).toThrowError(
			/EVENT_POLL_SECONDS must be a positive whole number/
		);
	});

	it('reports several bad values together, not just the first', () => {
		expect(() =>
			loadConfig({ ...baseEnv(), DEFAULT_LOCALE: 'fr-FR', LOG_LEVEL: 'verbose', HEALTH_PORT: 'abc' })
		).toThrowError(/DEFAULT_LOCALE.*LOG_LEVEL.*HEALTH_PORT/s);
	});
});
