import { describe, it, expect } from 'vitest';
import { renderHelpOverview, renderHelpTopic, HELP_TOPICS } from '../../src/commands/help.js';
import { messageKeys } from '../../src/i18n/index.js';

describe('renderHelpOverview', () => {
	it('names every real command group, in both locales', () => {
		for (const locale of ['en-US', 'pt-BR'] as const) {
			const content = renderHelpOverview(locale);
			expect(content).toContain('/connect');
			expect(content).toContain('/challenge');
			expect(content).toContain('/room');
			expect(content).toContain('/roll');
		}
	});
});

describe('renderHelpTopic', () => {
	it('has real content for every topic, in both locales', () => {
		for (const locale of ['en-US', 'pt-BR'] as const) {
			for (const topic of HELP_TOPICS) {
				const content = renderHelpTopic(locale, topic);
				expect(content.length).toBeGreaterThan(20);
				expect(content).not.toContain(`help.topic.${topic}`);
			}
		}
	});
});

describe('help message keys', () => {
	it('are present in both locale files for every topic and the overview', () => {
		const enKeys = new Set(messageKeys('en-US'));
		const ptKeys = new Set(messageKeys('pt-BR'));
		for (const topic of HELP_TOPICS) {
			expect(enKeys.has(`help.topic.${topic}`)).toBe(true);
			expect(ptKeys.has(`help.topic.${topic}`)).toBe(true);
			expect(enKeys.has(`help.overview.${topic}`)).toBe(true);
			expect(ptKeys.has(`help.overview.${topic}`)).toBe(true);
		}
	});
});
