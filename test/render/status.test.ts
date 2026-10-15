import { describe, it, expect } from 'vitest';
import { buildStatusEmbed } from '../../src/render/status.js';
import type { DiscoveredPool } from '../../src/be/temporaryState.js';

const POOLS: DiscoveredPool[] = [
	{ blockSlug: 'vampire-resources', poolName: 'Blood', permanent: 10, temporary: 7 },
];

describe('buildStatusEmbed', () => {
	it('lists every pool with its temporary over permanent rating', () => {
		const embed = buildStatusEmbed('en-US', 'Isolde Marchetti', POOLS, { bashing: 0, lethal: 0, aggravated: 0 }, {
			lost_traits: [],
			expended_abilities: [],
		});
		const poolsField = embed.fields?.find((f) => f.name === 'Pools');
		expect(poolsField?.value).toBe('Blood: 7 of 10');
	});

	it('shows no pools when the character holds none', () => {
		const embed = buildStatusEmbed('en-US', 'Detective Rosa Alvarez', [], { bashing: 0, lethal: 0, aggravated: 0 }, {
			lost_traits: [],
			expended_abilities: [],
		});
		const poolsField = embed.fields?.find((f) => f.name === 'Pools');
		expect(poolsField?.value).toBe('No pools');
	});

	it('lists every wound type by its own amount', () => {
		const embed = buildStatusEmbed('en-US', 'Konstantin Drake', [], { bashing: 2, lethal: 4, aggravated: 0 }, {
			lost_traits: [],
			expended_abilities: [],
		});
		const woundsField = embed.fields?.find((f) => f.name === 'Wounds');
		expect(woundsField?.value).toBe('**Bashing:** 2\n**Lethal:** 4\n**Aggravated:** 0');
	});

	it('shows "no losses yet tonight" when nothing has been lost', () => {
		const embed = buildStatusEmbed('en-US', 'Radu Bathory', [], { bashing: 0, lethal: 0, aggravated: 0 }, {
			lost_traits: [],
			expended_abilities: [],
		});
		const lossesField = embed.fields?.find((f) => f.name === "Tonight's losses");
		expect(lossesField?.value).toBe('No losses yet tonight');
	});

	it('lists every lost trait and expended ability', () => {
		const embed = buildStatusEmbed('en-US', 'Radu Bathory', [], { bashing: 0, lethal: 0, aggravated: 0 }, {
			lost_traits: [{ block_slug: 'vampire-abilities', name: 'Brawl' }],
			expended_abilities: [{ block_slug: 'vampire-abilities', name: 'Occult', levels: 2 }],
		});
		const lossesField = embed.fields?.find((f) => f.name === "Tonight's losses");
		expect(lossesField?.value).toBe('Brawl (lost)\nOccult (2 expended)');
	});

	it('renders in Portuguese when asked', () => {
		const embed = buildStatusEmbed('pt-BR', 'Isolde Marchetti', POOLS, { bashing: 0, lethal: 0, aggravated: 0 }, {
			lost_traits: [],
			expended_abilities: [],
		});
		expect(embed.fields?.map((f) => f.name)).toEqual(['Reservas', 'Feridas', 'Perdas desta noite']);
	});
});
