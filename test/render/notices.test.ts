import { describe, it, expect } from 'vitest';
import { formatNotice } from '../../src/render/notices.js';
import type { BotNotice } from '../../src/be/notices.js';

function notice(kind: string, payload: Record<string, unknown>): BotNotice {
	return { id: 1, wp_user_id: null, kind, payload, created_at: '2026-10-16 00:00:00' };
}

describe('formatNotice', () => {
	it('renders a change-decided notice', () => {
		const text = formatNotice('en-US', notice('change_decided', { character_name: 'Isolde', label: 'Occult 3', status: 'approved' }));
		expect(text).toContain('Isolde');
		expect(text).toContain('Occult 3');
		expect(text).toContain('approved');
	});

	it('renders a change-waiting staff notice', () => {
		expect(formatNotice('en-US', notice('change_waiting', { character_name: 'Isolde' }))).toContain('Isolde');
	});

	it('renders a downtime-in staff notice', () => {
		const text = formatNotice('en-US', notice('downtime_in', { plot_title: 'My Downtime', posted_by: 'Isolde' }));
		expect(text).toContain('My Downtime');
		expect(text).toContain('Isolde');
	});

	it('renders a plot-post player notice', () => {
		const text = formatNotice('en-US', notice('plot_post', { plot_title: 'The Harbor', posted_by: 'A Storyteller' }));
		expect(text).toContain('The Harbor');
	});

	it('renders each release kind with its character names', () => {
		for (const kind of ['release_rumor', 'release_entry', 'release_reveal']) {
			const text = formatNotice('en-US', notice(kind, { character_names: ['Isolde', 'Corwin'] }));
			expect(text).toContain('Isolde, Corwin');
		}
	});

	it('renders a link-request staff notice', () => {
		expect(formatNotice('en-US', notice('link_request', { discord_username: 'pagan71' }))).toContain('pagan71');
	});

	it('falls back to a generic line for an unknown kind', () => {
		expect(formatNotice('en-US', notice('something_new', {}))).toContain('something_new');
	});

	it('renders in Portuguese too', () => {
		const text = formatNotice('pt-BR', notice('link_request', { discord_username: 'pagan71' }));
		expect(text).toContain('pagan71');
		expect(text).toContain('vinculado');
	});

	it('tolerates a missing or malformed payload field rather than throwing', () => {
		expect(() => formatNotice('en-US', notice('change_decided', {}))).not.toThrow();
		expect(() => formatNotice('en-US', notice('release_rumor', { character_names: 'not-an-array' }))).not.toThrow();
	});
});
