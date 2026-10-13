import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Locale } from '../config.js';

export type { Locale };

type Messages = Record<string, string>;

const DIR = dirname(fileURLToPath(import.meta.url));

function loadMessages(locale: Locale): Messages {
	return JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8')) as Messages;
}

const MESSAGES: Record<Locale, Messages> = {
	'en-US': loadMessages('en-US'),
	'pt-BR': loadMessages('pt-BR'),
};

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Looks up one message by key in the given locale, falling back to en-US and then to the bare key
 * when a translation is missing, and fills in any `{named}` placeholders.
 */
export function t(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
	const template = MESSAGES[locale]?.[key] ?? MESSAGES['en-US'][key] ?? key;
	return template.replace(PLACEHOLDER, (_match, name: string) => {
		const value = params[name];
		return value === undefined ? `{${name}}` : String(value);
	});
}

/**
 * Every message key defined for a locale - used to keep `en-US.json` and `pt-BR.json` in step.
 */
export function messageKeys(locale: Locale): string[] {
	return Object.keys(MESSAGES[locale]);
}

/**
 * The `{named}` placeholders a message template uses, for the same key/placeholder consistency check.
 */
export function placeholdersIn(locale: Locale, key: string): Set<string> {
	const template = MESSAGES[locale]?.[key] ?? '';
	const found = new Set<string>();
	for (const match of template.matchAll(PLACEHOLDER)) {
		const name = match[1];
		if (name !== undefined) {
			found.add(name);
		}
	}
	return found;
}

/**
 * `pt-BR` when the given Discord locale string is Portuguese (Brazil), English otherwise.
 */
export function resolveLocale(discordLocale: string | null | undefined): Locale {
	return discordLocale === 'pt-BR' ? 'pt-BR' : 'en-US';
}
