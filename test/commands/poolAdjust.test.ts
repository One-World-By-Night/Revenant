import { describe, it, expect } from 'vitest';
import { formatPoolReply } from '../../src/commands/poolAdjust.js';

describe('formatPoolReply', () => {
	it('shows the new temporary rating over permanent', () => {
		expect(formatPoolReply('en-US', 'Blood', 10, { permanent: 10, temporary: 8 }, -2)).toBe('**Blood**: 8 of 10 temporary');
	});

	it('adds a clamped note when the pool moved by less than the requested delta', () => {
		const reply = formatPoolReply('en-US', 'Blood', 1, { permanent: 10, temporary: 0 }, -2);
		expect(reply).toContain('**Blood**: 0 of 10 temporary');
		expect(reply).toContain('clamped');
	});

	it('adds no clamped note when the pool moved by the full requested delta', () => {
		const reply = formatPoolReply('en-US', 'Blood', 10, { permanent: 10, temporary: 8 }, -2);
		expect(reply).not.toContain('clamped');
	});

	it('renders in Portuguese when asked', () => {
		const reply = formatPoolReply('pt-BR', 'Sangue', 10, { permanent: 10, temporary: 8 }, -2);
		expect(reply).toBe('**Sangue**: 8 de 10 temporário');
	});
});
