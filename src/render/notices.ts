import { t, type Locale } from '../i18n/index.js';
import type { BotNotice } from '../be/notices.js';

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function names(value: unknown): string {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').join(', ') : '';
}

/**
 * One notice's own Discord-ready text, in the caller's locale - every real `kind` this project's BE
 * side writes, falling back to a generic line for one it doesn't recognize rather than throwing.
 */
export function formatNotice(locale: Locale, notice: BotNotice): string {
	const payload = notice.payload;
	switch (notice.kind) {
		case 'change_decided':
			return t(locale, 'notice.changeDecided', {
				character: str(payload.character_name),
				label: str(payload.label),
				status: str(payload.status),
			});
		case 'change_waiting':
			return t(locale, 'notice.changeWaiting', { character: str(payload.character_name) });
		case 'downtime_in':
			return t(locale, 'notice.downtimeIn', { plot: str(payload.plot_title), postedBy: str(payload.posted_by) });
		case 'plot_post':
			return t(locale, 'notice.plotPost', { plot: str(payload.plot_title), postedBy: str(payload.posted_by) });
		case 'release_rumor':
			return t(locale, 'notice.releaseRumor', { characters: names(payload.character_names) });
		case 'release_entry':
			return t(locale, 'notice.releaseEntry', { characters: names(payload.character_names) });
		case 'release_reveal':
			return t(locale, 'notice.releaseReveal', { characters: names(payload.character_names) });
		case 'link_request':
			return t(locale, 'notice.linkRequest', { username: str(payload.discord_username) });
		default:
			return t(locale, 'notice.generic', { kind: notice.kind });
	}
}
