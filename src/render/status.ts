import type { APIEmbed, APIEmbedField } from 'discord.js';
import { t, type Locale } from '../i18n/index.js';
import type { DiscoveredPool, NightLosses, Wounds, WoundType } from '../be/temporaryState.js';
import { NEUTRAL_GREY } from './sheet.js';

const WOUND_TYPE_KEYS: Record<WoundType, string> = {
	bashing: 'status.woundBashing',
	lethal: 'status.woundLethal',
	aggravated: 'status.woundAggravated',
};

function poolsLines(locale: Locale, pools: DiscoveredPool[]): string[] {
	if (pools.length === 0) {
		return [t(locale, 'status.noPools')];
	}
	return pools.map((pool) => t(locale, 'status.poolLine', { name: pool.poolName, temporary: pool.temporary, permanent: pool.permanent }));
}

function woundsLines(locale: Locale, wounds: Wounds): string[] {
	return (['bashing', 'lethal', 'aggravated'] as WoundType[]).map((type) =>
		t(locale, 'status.woundLine', { type: t(locale, WOUND_TYPE_KEYS[type]), amount: wounds[type] })
	);
}

function lossesLines(locale: Locale, losses: NightLosses): string[] {
	const traitLines = losses.lost_traits.map((trait) => t(locale, 'status.lostTraitLine', { name: trait.name }));
	const abilityLines = losses.expended_abilities.map((ability) =>
		t(locale, 'status.expendedAbilityLine', { name: ability.name, levels: ability.levels })
	);
	const lines = [...traitLines, ...abilityLines];
	return lines.length === 0 ? [t(locale, 'status.noLosses')] : lines;
}

/**
 * One embed holding a character's tonight's state: every held resource pool, its wound state by
 * type, and what it's lost or expended so far tonight.
 */
export function buildStatusEmbed(
	locale: Locale,
	characterName: string,
	pools: DiscoveredPool[],
	wounds: Wounds,
	losses: NightLosses
): APIEmbed {
	const fields: APIEmbedField[] = [
		{ name: t(locale, 'status.poolsField'), value: poolsLines(locale, pools).join('\n'), inline: false },
		{ name: t(locale, 'status.woundsField'), value: woundsLines(locale, wounds).join('\n'), inline: false },
		{ name: t(locale, 'status.lossesField'), value: lossesLines(locale, losses).join('\n'), inline: false },
	];

	return {
		title: characterName,
		color: NEUTRAL_GREY,
		fields,
	};
}
