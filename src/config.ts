export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Locale = 'en-US' | 'pt-BR';

export interface Config {
	discordToken: string;
	discordApplicationId: string;
	databaseUrl: string;
	secretKey: Buffer;
	botDisplayName: string;
	defaultLocale: Locale;
	logLevel: LogLevel;
	healthPort: number;
	devGuildId: string | undefined;
	allowInsecureLocalhost: boolean;
	eventPollSeconds: number | undefined;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LOCALES: readonly Locale[] = ['en-US', 'pt-BR'];

function parseBoolean(name: string, raw: string | undefined, errors: string[]): boolean {
	if (raw === undefined || raw === '') {
		return false;
	}
	const lowered = raw.toLowerCase();
	if (lowered === 'true' || lowered === '1') {
		return true;
	}
	if (lowered === 'false' || lowered === '0') {
		return false;
	}
	errors.push(`${name} must be true or false, got "${raw}"`);
	return false;
}

function parsePort(name: string, raw: string | undefined, fallback: number, errors: string[]): number {
	if (raw === undefined || raw === '') {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		errors.push(`${name} must be a port number from 1 to 65535, got "${raw}"`);
		return fallback;
	}
	return value;
}

function parsePositiveInt(name: string, raw: string | undefined, errors: string[]): number | undefined {
	if (raw === undefined || raw === '') {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) {
		errors.push(`${name} must be a positive whole number, got "${raw}"`);
		return undefined;
	}
	return value;
}

function parseSecretKey(raw: string | undefined, errors: string[]): Buffer {
	if (raw === undefined || raw === '') {
		errors.push('SECRET_KEY is required');
		return Buffer.alloc(32);
	}
	let decoded: Buffer;
	try {
		decoded = Buffer.from(raw, 'base64');
	} catch {
		errors.push('SECRET_KEY must be base64-encoded');
		return Buffer.alloc(32);
	}
	if (decoded.length !== 32) {
		errors.push(`SECRET_KEY must decode to exactly 32 bytes, got ${decoded.length}`);
		return Buffer.alloc(32);
	}
	return decoded;
}

function requireString(name: string, raw: string | undefined, errors: string[]): string {
	if (raw === undefined || raw.trim() === '') {
		errors.push(`${name} is required`);
		return '';
	}
	return raw;
}

function parseEnum<T extends string>(
	name: string,
	raw: string | undefined,
	allowed: readonly T[],
	fallback: T,
	errors: string[]
): T {
	if (raw === undefined || raw === '') {
		return fallback;
	}
	if ((allowed as readonly string[]).includes(raw)) {
		return raw as T;
	}
	errors.push(`${name} must be one of ${allowed.join(', ')}, got "${raw}"`);
	return fallback;
}

/**
 * Reads and validates every configuration value from the environment. Throws one error naming every
 * missing or bad value when any are found.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const errors: string[] = [];

	const config: Config = {
		discordToken: requireString('DISCORD_TOKEN', env.DISCORD_TOKEN, errors),
		discordApplicationId: requireString('DISCORD_APPLICATION_ID', env.DISCORD_APPLICATION_ID, errors),
		databaseUrl: requireString('DATABASE_URL', env.DATABASE_URL, errors),
		secretKey: parseSecretKey(env.SECRET_KEY, errors),
		botDisplayName: env.BOT_DISPLAY_NAME || 'Revenant',
		defaultLocale: parseEnum('DEFAULT_LOCALE', env.DEFAULT_LOCALE, LOCALES, 'en-US', errors),
		logLevel: parseEnum('LOG_LEVEL', env.LOG_LEVEL, LOG_LEVELS, 'info', errors),
		healthPort: parsePort('HEALTH_PORT', env.HEALTH_PORT, 8080, errors),
		devGuildId: env.DEV_GUILD_ID || undefined,
		allowInsecureLocalhost: parseBoolean('ALLOW_INSECURE_LOCALHOST', env.ALLOW_INSECURE_LOCALHOST, errors),
		eventPollSeconds: parsePositiveInt('EVENT_POLL_SECONDS', env.EVENT_POLL_SECONDS, errors),
	};

	if (errors.length > 0) {
		throw new Error(`Configuration problem: ${errors.join('; ')}`);
	}

	return config;
}
