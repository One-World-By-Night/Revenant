import type { APIEmbed, APIEmbedField } from 'discord.js';
import { t, type Locale } from '../i18n/index.js';
import type { PlotEntryRow, PlotWithEntries } from '../be/gameNight.js';
import { NEUTRAL_GREY } from './sheet.js';

const MAX_ENTRIES_SHOWN = 8;
const ENTRY_VALUE_LIMIT = 200;

/**
 * An entry's content, cut to a field-sized excerpt - Discord's own embed field value limit is 1024,
 * but several of these share one embed so each stays far short of that.
 */
export function truncateEntryContent(content: string): string {
	if (content.length <= ENTRY_VALUE_LIMIT) {
		return content;
	}
	return `${content.slice(0, ENTRY_VALUE_LIMIT)}…`;
}

function entryField(entry: PlotEntryRow): APIEmbedField {
	const date = entry.event_date ?? entry.created_at.slice(0, 10);
	return {
		name: `${entry.entry_type} — ${date}`,
		value: truncateEntryContent(entry.content === '' ? '(empty)' : entry.content),
		inline: false,
	};
}

/**
 * One embed holding a plot's own most recent entries, newest first - a quick read, not the full
 * record BE's own site shows.
 */
export function buildPlotEmbed(locale: Locale, plot: PlotWithEntries): APIEmbed {
	const newestFirst = [...plot.entries].reverse();
	const shown = newestFirst.slice(0, MAX_ENTRIES_SHOWN);

	const fields: APIEmbedField[] =
		shown.length === 0 ? [{ name: t(locale, 'plot.noEntries'), value: '​', inline: false }] : shown.map(entryField);

	if (newestFirst.length > shown.length) {
		fields.push({
			name: '​',
			value: t(locale, 'plot.moreEntries', { count: newestFirst.length - shown.length }),
			inline: false,
		});
	}

	return {
		title: plot.title,
		...(plot.game_date ? { description: t(locale, 'plot.gameDate', { date: plot.game_date }) } : {}),
		color: NEUTRAL_GREY,
		fields,
	};
}
