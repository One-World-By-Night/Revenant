import type { APIEmbed, APIEmbedField } from 'discord.js';

export type HeaderTuple = [string, string] | [string, string, number];

export interface SheetRow {
	text: string;
	indent: number;
	circles: number;
}

export type SheetRowValue = string | SheetRow;

export interface SheetSection {
	block_slug: string;
	section_type: string;
	title: string;
	rows?: SheetRowValue[];
	groups?: Array<{ label: string | null; rows: SheetRowValue[] }>;
}

export interface SheetDocument {
	title: string;
	subtitle: string;
	header: HeaderTuple[];
	sections: SheetSection[];
}

const MAX_FIELD_VALUE = 1024;
const MAX_FIELDS_PER_EMBED = 25;
const MAX_EMBED_TOTAL = 6000;
export const MAX_EMBEDS_PER_PAGE = 10;
export const NEUTRAL_GREY = 0x95a5a6;

function rowText(row: SheetRowValue): string {
	return typeof row === 'string' ? row : row.text;
}

/**
 * Every row of a section flattened to text, in document order, across its groups when it has them.
 */
export function sectionLines(section: SheetSection): string[] {
	if (section.groups) {
		return section.groups.flatMap((group) => group.rows.map(rowText));
	}
	return (section.rows ?? []).map(rowText);
}

function splitIntoChunks(lines: string[], maxLength: number): string[] {
	const chunks: string[] = [];
	let current: string[] = [];
	let currentLength = 0;
	for (const line of lines) {
		const addedLength = current.length === 0 ? line.length : line.length + 1;
		if (current.length > 0 && currentLength + addedLength > maxLength) {
			chunks.push(current.join('\n'));
			current = [];
			currentLength = 0;
		}
		current.push(line);
		currentLength += current.length === 1 ? line.length : line.length + 1;
	}
	if (current.length > 0) {
		chunks.push(current.join('\n'));
	}
	return chunks;
}

/**
 * A section's own fields: one, or several titled "{title} (cont.)" when its rows don't fit in 1024
 * characters. Empty when the section has no rows, so it is left out entirely.
 */
export function sectionFields(section: SheetSection): APIEmbedField[] {
	const lines = sectionLines(section);
	if (lines.length === 0) {
		return [];
	}
	return splitIntoChunks(lines, MAX_FIELD_VALUE).map((value, index) => ({
		name: index === 0 ? section.title : `${section.title} (cont.)`,
		value,
		inline: false,
	}));
}

function headerFields(header: HeaderTuple[]): APIEmbedField[] {
	return header.map(([name, value]) => ({ name, value, inline: true }));
}

function fieldLength(field: APIEmbedField): number {
	return field.name.length + field.value.length;
}

/**
 * Parses a `#rrggbb` hex color into the integer Discord embeds take, or null for anything blank or
 * not a real hex color.
 */
export function parseAccentColor(hex: string | null | undefined): number | null {
	if (!hex) {
		return null;
	}
	const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
	if (!match?.[1]) {
		return null;
	}
	return parseInt(match[1], 16);
}

/**
 * Turns a sheet document into the full set of embeds for `/sheet`'s default view: the first carries
 * the character's name, header facts as inline fields, and the chronicle's name in the footer; every
 * field after that - header facts then every section in order - fills embeds in sequence up to
 * Discord's 25-field and 6,000-character limits. Nothing in the document is reinterpreted: a row's
 * text is used exactly as the document gives it.
 */
export function buildSheetEmbeds(doc: SheetDocument, options: { accentColor: number | null; footerText: string }): APIEmbed[] {
	const fields = [...headerFields(doc.header), ...doc.sections.flatMap(sectionFields)];
	const embeds: APIEmbed[] = [];
	let pending: APIEmbedField[] = [];
	let pendingLength = 0;

	function baseLength(isFirstEmbed: boolean): number {
		return isFirstEmbed ? doc.title.length + doc.subtitle.length + options.footerText.length : 0;
	}

	function pushEmbed(): void {
		const isFirstEmbed = embeds.length === 0;
		embeds.push({
			...(isFirstEmbed ? { title: doc.title, footer: { text: options.footerText } } : {}),
			...(isFirstEmbed && doc.subtitle ? { description: doc.subtitle } : {}),
			color: options.accentColor ?? NEUTRAL_GREY,
			fields: pending,
		});
		pending = [];
		pendingLength = 0;
	}

	for (const field of fields) {
		const isFirstEmbed = embeds.length === 0;
		const wouldExceed =
			pending.length > 0 &&
			(pending.length >= MAX_FIELDS_PER_EMBED || baseLength(isFirstEmbed) + pendingLength + fieldLength(field) > MAX_EMBED_TOTAL);
		if (wouldExceed) {
			pushEmbed();
		}
		pending.push(field);
		pendingLength += fieldLength(field);
	}
	if (pending.length > 0 || embeds.length === 0) {
		pushEmbed();
	}
	return embeds;
}

/**
 * One embed holding a single section's fields, with the character's name in the title - `/sheet`'s
 * `section:` view. Null when the document has no section matching that title, case-insensitively.
 */
export function buildSingleSectionEmbed(doc: SheetDocument, sectionTitle: string, accentColor: number | null): APIEmbed | null {
	const section = doc.sections.find((candidate) => candidate.title.toLowerCase() === sectionTitle.toLowerCase());
	if (!section) {
		return null;
	}
	return {
		title: doc.title,
		color: accentColor ?? NEUTRAL_GREY,
		fields: sectionFields(section),
	};
}

/**
 * Splits a full embed list into pages of at most `pageSize` embeds, Discord's own per-message limit.
 */
export function paginateEmbeds(embeds: APIEmbed[], pageSize: number = MAX_EMBEDS_PER_PAGE): APIEmbed[][] {
	if (embeds.length === 0) {
		return [[]];
	}
	const pages: APIEmbed[][] = [];
	for (let i = 0; i < embeds.length; i += pageSize) {
		pages.push(embeds.slice(i, i + pageSize));
	}
	return pages;
}
