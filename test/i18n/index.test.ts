import { describe, it, expect } from 'vitest';
import { t, messageKeys, placeholdersIn, resolveLocale } from '../../src/i18n/index.js';

describe('t', () => {
	it('returns a message with no placeholders', () => {
		expect(t('en-US', 'disconnect.success')).toBe('Disconnected.');
	});

	it('fills in a named placeholder', () => {
		expect(t('en-US', 'connect.unreachable', { site: 'example.test' })).toBe("Couldn't reach example.test.");
	});

	it('fills in several placeholders', () => {
		expect(t('pt-BR', 'connect.success', { gameName: 'Kingdom of Night' })).toContain('Kingdom of Night');
	});

	it('leaves a placeholder visible when no value is given for it', () => {
		expect(t('en-US', 'connect.unreachable')).toBe("Couldn't reach {site}.");
	});

	it('returns the Portuguese message for pt-BR', () => {
		expect(t('pt-BR', 'disconnect.success')).toBe('Desconectado.');
	});

	it('falls back to en-US when a key has no translation for a locale', () => {
		expect(t('pt-BR', 'a.key.that.does.not.exist')).toBe('a.key.that.does.not.exist');
	});
});

describe('resolveLocale', () => {
	it('resolves pt-BR to Portuguese', () => {
		expect(resolveLocale('pt-BR')).toBe('pt-BR');
	});

	it('resolves anything else to English', () => {
		expect(resolveLocale('en-GB')).toBe('en-US');
		expect(resolveLocale('fr')).toBe('en-US');
		expect(resolveLocale(null)).toBe('en-US');
		expect(resolveLocale(undefined)).toBe('en-US');
	});
});

describe('the two message catalogs stay in step', () => {
	it('have exactly the same keys', () => {
		const en = messageKeys('en-US').sort();
		const pt = messageKeys('pt-BR').sort();
		expect(pt).toEqual(en);
	});

	it('use the same placeholders in both languages, for every key', () => {
		const mismatched: string[] = [];
		for (const key of messageKeys('en-US')) {
			const en = placeholdersIn('en-US', key);
			const pt = placeholdersIn('pt-BR', key);
			const same = en.size === pt.size && [...en].every((name) => pt.has(name));
			if (!same) {
				mismatched.push(key);
			}
		}
		expect(mismatched).toEqual([]);
	});
});
