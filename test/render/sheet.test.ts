import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
	buildSheetEmbeds,
	buildSingleSectionEmbed,
	paginateEmbeds,
	parseAccentColor,
	sectionFields,
	sectionLines,
	type SheetDocument,
	type SheetSection,
} from '../../src/render/sheet.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(DIR, '../fixtures/sheets');

function loadFixture(name: string): SheetDocument {
	return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8')) as SheetDocument;
}

const FIXTURE_NAMES = readdirSync(FIXTURES_DIR)
	.filter((file) => file.endsWith('.json'))
	.map((file) => file.replace(/\.json$/, ''));

describe('real sheet fixtures, one per creature type', () => {
	it('captured a fixture for every creature type the demo chronicle has', () => {
		expect(FIXTURE_NAMES.sort()).toEqual(
			['bete', 'changeling', 'demon', 'fera', 'hunter', 'kueijin', 'mage', 'mortal', 'mummy', 'vampire', 'werewolf', 'wraith'].sort()
		);
	});

	for (const name of FIXTURE_NAMES) {
		it(`renders ${name} without losing or inventing a row`, () => {
			const doc = loadFixture(name);
			const embeds = buildSheetEmbeds(doc, { accentColor: null, footerText: doc.title });

			const sectionRowCount = doc.sections.reduce((sum, section) => sum + sectionLines(section).length, 0);
			const nonEmptySections = doc.sections.filter((section) => sectionLines(section).length > 0);

			const allFields = embeds.flatMap((embed) => embed.fields ?? []);
			expect(allFields).toHaveLength(doc.header.length + nonEmptySections.reduce((sum, s) => sum + sectionFields(s).length, 0));

			const renderedLines = allFields
				.filter((field) => !doc.header.some(([label]) => label === field.name))
				.flatMap((field) => field.value.split('\n'));
			expect(renderedLines).toHaveLength(sectionRowCount);

			for (const embed of embeds) {
				expect((embed.fields ?? []).length).toBeLessThanOrEqual(25);
			}
			expect(embeds[0]?.title).toBe(doc.title);
			expect(embeds[0]?.description).toBe(doc.subtitle);
		});
	}

	it('vampire has enough header and section fields to spill into a second embed', () => {
		const doc = loadFixture('vampire');
		const embeds = buildSheetEmbeds(doc, { accentColor: null, footerText: 'Linking by Night' });
		expect(embeds.length).toBeGreaterThanOrEqual(2);
		expect(embeds[1]?.title).toBeUndefined();
		expect(embeds[1]?.footer).toBeUndefined();
	});

	it("renders Isolde's Vampire Abilities section with the exact text the document gives", () => {
		const doc = loadFixture('vampire');
		const abilities = doc.sections.find((section) => section.block_slug === 'vampire-abilities');
		expect(abilities).toBeDefined();
		expect(sectionLines(abilities as SheetSection)).toEqual(['Academics x3', 'Etiquette x2', 'Investigation x2', 'Occult x4']);
	});

	it('leaves a section with no rows out of the embeds entirely', () => {
		const doc = loadFixture('vampire');
		const withEmptySection: SheetDocument = {
			...doc,
			sections: [...doc.sections, { block_slug: 'empty-test', section_type: 'trait_list', title: 'Nothing Here', groups: [] }],
		};
		const embeds = buildSheetEmbeds(withEmptySection, { accentColor: null, footerText: 'x' });
		const names = embeds.flatMap((embed) => (embed.fields ?? []).map((field) => field.name));
		expect(names).not.toContain('Nothing Here');
	});
});

describe('splitting a long section into (cont.) fields', () => {
	const longSection: SheetSection = {
		block_slug: 'test',
		section_type: 'trait_list',
		title: 'Long Section',
		groups: [{ label: null, rows: Array.from({ length: 60 }, (_, i) => `Trait Number ${i} x5`) }],
	};

	it('keeps one field when everything fits in 1024 characters', () => {
		const short: SheetSection = { ...longSection, groups: [{ label: null, rows: ['One', 'Two', 'Three'] }] };
		expect(sectionFields(short)).toHaveLength(1);
		expect(sectionFields(short)[0]?.name).toBe('Long Section');
	});

	it('continues past 1024 characters as "(cont.)", never splitting a line in half', () => {
		const fields = sectionFields(longSection);
		expect(fields.length).toBeGreaterThan(1);
		expect(fields[0]?.name).toBe('Long Section');
		expect(fields[1]?.name).toBe('Long Section (cont.)');
		for (const field of fields) {
			expect(field.value.length).toBeLessThanOrEqual(1024);
		}
		const rejoined = fields.flatMap((field) => field.value.split('\n'));
		expect(rejoined).toEqual(longSection.groups?.[0]?.rows);
	});
});

describe('buildSingleSectionEmbed', () => {
	const doc = loadFixture('vampire');

	it('finds a section case-insensitively and titles the embed with the character name', () => {
		const embed = buildSingleSectionEmbed(doc, 'vampire abilities · 11', null);
		expect(embed?.title).toBe('Isolde Marchetti');
		expect(embed?.fields?.[0]?.name).toBe('Vampire Abilities · 11');
	});

	it('is null when no section matches', () => {
		expect(buildSingleSectionEmbed(doc, 'Not A Real Section', null)).toBeNull();
	});
});

describe('parseAccentColor', () => {
	it('parses a hex color to its integer value', () => {
		expect(parseAccentColor('#1a2b3c')).toBe(0x1a2b3c);
	});

	it('accepts a hex color with no leading #', () => {
		expect(parseAccentColor('1a2b3c')).toBe(0x1a2b3c);
	});

	it('is null for an empty, missing, or malformed value', () => {
		expect(parseAccentColor('')).toBeNull();
		expect(parseAccentColor(null)).toBeNull();
		expect(parseAccentColor(undefined)).toBeNull();
		expect(parseAccentColor('not-a-color')).toBeNull();
	});
});

describe('paginateEmbeds', () => {
	it('returns one empty page for no embeds', () => {
		expect(paginateEmbeds([])).toEqual([[]]);
	});

	it('keeps everything on one page at or under the page size', () => {
		const embeds = Array.from({ length: 10 }, () => ({}));
		expect(paginateEmbeds(embeds)).toHaveLength(1);
	});

	it('splits past 10 embeds into a second page', () => {
		const embeds = Array.from({ length: 13 }, () => ({}));
		const pages = paginateEmbeds(embeds);
		expect(pages).toHaveLength(2);
		expect(pages[0]).toHaveLength(10);
		expect(pages[1]).toHaveLength(3);
	});
});

describe('tonight\'s spends beside each row (step 2)', () => {
	const doc = JSON.parse(readFileSync(join(DIR, '../fixtures/sheet-markers.json'), 'utf8')) as SheetDocument;

	it('is a real capture, not a guess: BE 1.6.1.1 wrote it, this file never edits it', () => {
		const provenance = (doc as unknown as { provenance_lines?: string[] }).provenance_lines ?? [];
		expect(provenance.join(' ')).toContain('Beyond Elysium 1.6.1.1');
	});

	it('carries a spent pool\'s temporary marker through a header pair unchanged', () => {
		const embeds = buildSheetEmbeds(doc, { accentColor: null, footerText: doc.title });
		const bloodField = embeds[0]?.fields?.find((f) => f.name === 'Blood');
		expect(bloodField?.value).toBe('x10 (7 temporary)');
	});

	it('carries a lost trait\'s marker through a body section row unchanged', () => {
		const abilities = doc.sections.find((s) => s.block_slug === 'vampire-abilities');
		expect(abilities).toBeDefined();
		expect(sectionLines(abilities as SheetSection)).toEqual(['Brawl x3 (lost tonight)']);
	});
});
