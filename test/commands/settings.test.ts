import { describe, it, expect } from 'vitest';
import {
	describePoolRules,
	describeLanguage,
	languageChoiceToStoredLocale,
	formatSettingsSummary,
} from '../../src/commands/settings.js';

describe('describePoolRules', () => {
	it('names each rule set', () => {
		expect(describePoolRules('revised')).toBe('Revised');
		expect(describePoolRules('v20')).toBe('V20');
	});
});

describe('describeLanguage', () => {
	it('names a saved locale', () => {
		expect(describeLanguage('en-US', 'pt-BR')).toBe('Portuguese (Brazil)');
		expect(describeLanguage('en-US', 'en-US')).toBe('English (US)');
	});

	it('falls back to the default phrase when nothing is saved', () => {
		expect(describeLanguage('en-US', null)).toBe("the server's Discord language");
		expect(describeLanguage('pt-BR', null)).toBe('o idioma do Discord do servidor');
	});
});

describe('languageChoiceToStoredLocale', () => {
	it('passes a real locale through', () => {
		expect(languageChoiceToStoredLocale('pt-BR')).toBe('pt-BR');
		expect(languageChoiceToStoredLocale('en-US')).toBe('en-US');
	});

	it('clears to null for default', () => {
		expect(languageChoiceToStoredLocale('default')).toBeNull();
	});
});

describe('formatSettingsSummary', () => {
	it('renders every field, with a mention for a set staff channel', () => {
		const summary = formatSettingsSummary('en-US', {
			poolRules: 'v20',
			staffChannelId: '123',
			storedLocale: 'pt-BR',
			traitCap: 30,
			challengeTimeoutMinutes: 45,
			roleSyncEnabled: true,
			playerRoleId: '111',
			narratorRoleId: '222',
			storytellerRoleId: '333',
		});
		expect(summary).toContain('V20');
		expect(summary).toContain('<#123>');
		expect(summary).toContain('Portuguese (Brazil)');
		expect(summary).toContain('30');
		expect(summary).toContain('45');
		expect(summary).toContain('on');
		expect(summary).toContain('<@&111>');
		expect(summary).toContain('<@&222>');
		expect(summary).toContain('<@&333>');
	});

	it('shows "not set" for no staff channel, trait cap or role', () => {
		const summary = formatSettingsSummary('en-US', {
			poolRules: 'revised',
			staffChannelId: null,
			storedLocale: null,
			traitCap: null,
			challengeTimeoutMinutes: 60,
			roleSyncEnabled: false,
			playerRoleId: null,
			narratorRoleId: null,
			storytellerRoleId: null,
		});
		expect(summary.match(/not set/g)).toHaveLength(5);
		expect(summary).toContain('off');
	});
});
