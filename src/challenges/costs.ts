import type { Outcome, Side } from './engine.js';
import {
	addNightLoss,
	clearNightLosses,
	fetchCharacterRaw,
	readNightLosses,
	takeWound,
	healWound,
	type Connection,
	type WoundType,
} from '../be/temporaryState.js';

export interface TraitLocation {
	trait: string;
	blockSlug: string;
}

export interface CharacterSide {
	characterId: number;
	discordUserId: string;
}

export interface WoundResult {
	type: WoundType;
	amount: number;
	armor: number;
}

export interface CostTarget {
	/** Null for a side with no BE character at all - a Narrator claiming a difficulty count in `/static`, say. */
	challenger: CharacterSide | null;
	defender: CharacterSide | null;
	reason: string;
	/** Where each possible bid Trait name lives on a sheet - resolved by the Discord layer at claim time. */
	traitLocations: TraitLocation[];
	/** Which of a side's used retest sources are Abilities, with the block they live on. */
	abilityLocations: TraitLocation[];
	wound?: WoundResult;
}

export interface AppliedCost {
	side: Side;
	kind: 'trait_lost' | 'ability_expended' | 'wound';
	payload: Record<string, unknown>;
	/** True when this side has no BE character - recorded for the bot's own tracking only, never sent to BE. */
	noCharacter?: boolean;
}

function locate(locations: TraitLocation[], name: string): TraitLocation | undefined {
	return locations.find((location) => location.trait === name);
}

function characterFor(target: CostTarget, side: Side): CharacterSide | null {
	return side === 'challenger' ? target.challenger : target.defender;
}

/**
 * Sends a settled challenge's own costs to BE: every lost Trait and expended Ability for the
 * loser (or both sides on a draw), and the loser's wound when the challenge was an attack - each
 * through the same routes a player typing `/spend`/`/wound` already uses, each reason naming this
 * challenge. A side with no BE character (a Narrator claiming a difficulty count) gets every cost
 * recorded for the bot's own tracking instead, with no BE call at all.
 */
export async function applyCosts(connection: Connection, secret: Buffer, outcome: Outcome, target: CostTarget): Promise<AppliedCost[]> {
	const losers: Side[] = outcome.loser === 'both' ? ['challenger', 'defender'] : [outcome.loser];
	const applied: AppliedCost[] = [];

	for (const side of losers) {
		const character = characterFor(target, side);
		for (const trait of outcome.lostTraits) {
			const location = locate(target.traitLocations, trait);
			if (!location) {
				continue;
			}
			if (!character) {
				applied.push({ side, kind: 'trait_lost', payload: { trait }, noCharacter: true });
				continue;
			}
			await addNightLoss(connection, secret, character.discordUserId, character.characterId, 'trait', location.blockSlug, trait, target.reason);
			applied.push({ side, kind: 'trait_lost', payload: { trait, blockSlug: location.blockSlug } });
		}
		for (const source of outcome.expendedAbilities) {
			const location = locate(target.abilityLocations, source);
			if (!location) {
				continue;
			}
			if (!character) {
				applied.push({ side, kind: 'ability_expended', payload: { ability: source }, noCharacter: true });
				continue;
			}
			await addNightLoss(connection, secret, character.discordUserId, character.characterId, 'ability', location.blockSlug, source, target.reason, 1);
			applied.push({ side, kind: 'ability_expended', payload: { ability: source, blockSlug: location.blockSlug } });
		}
	}

	if (target.wound && outcome.loser !== 'both') {
		const character = characterFor(target, outcome.loser);
		if (!character) {
			applied.push({ side: outcome.loser, kind: 'wound', payload: { type: target.wound.type, amount: target.wound.amount, armor: target.wound.armor }, noCharacter: true });
			return applied;
		}
		const reason = target.wound.armor > 0 ? `${target.wound.armor} to armor. ${target.reason}` : target.reason;
		await takeWound(connection, secret, character.discordUserId, character.characterId, target.wound.type, target.wound.amount, reason);
		applied.push({ side: outcome.loser, kind: 'wound', payload: { type: target.wound.type, amount: target.wound.amount, armor: target.wound.armor } });
	}

	return applied;
}

/**
 * Reverses a single applied cost - a wound heals directly; a lost Trait or expended Ability has no
 * single-entry removal route on BE, so this reads the character's full night losses, clears them,
 * and re-adds back every entry except the one being reversed - never a bare clear, which would also
 * erase whatever else the character lost that same night from an unrelated challenge.
 */
export async function reverseCost(
	connection: Connection,
	secret: Buffer,
	cost: AppliedCost,
	target: CostTarget,
	correctionReason: string
): Promise<void> {
	const character = characterFor(target, cost.side);
	if (!character) {
		return;
	}

	if (cost.kind === 'wound') {
		const payload = cost.payload as { type: WoundType; amount: number };
		await healWound(connection, secret, character.discordUserId, character.characterId, payload.type, payload.amount);
		return;
	}

	const current = await fetchCharacterRaw(connection, secret, character.discordUserId, character.characterId);
	const losses = readNightLosses(current.sheet_data);
	await clearNightLosses(connection, secret, character.discordUserId, character.characterId, correctionReason);

	if (cost.kind === 'trait_lost') {
		const removedTrait = cost.payload as { trait: string; blockSlug: string };
		for (const lost of losses.lost_traits) {
			if (lost.name === removedTrait.trait && lost.block_slug === removedTrait.blockSlug) {
				continue;
			}
			await addNightLoss(connection, secret, character.discordUserId, character.characterId, 'trait', lost.block_slug, lost.name, correctionReason);
		}
		for (const expended of losses.expended_abilities) {
			await addNightLoss(
				connection,
				secret,
				character.discordUserId,
				character.characterId,
				'ability',
				expended.block_slug,
				expended.name,
				correctionReason,
				expended.levels
			);
		}
		return;
	}

	const removedAbility = cost.payload as { ability: string; blockSlug: string };
	for (const lost of losses.lost_traits) {
		await addNightLoss(connection, secret, character.discordUserId, character.characterId, 'trait', lost.block_slug, lost.name, correctionReason);
	}
	for (const expended of losses.expended_abilities) {
		if (expended.name === removedAbility.ability && expended.block_slug === removedAbility.blockSlug) {
			continue;
		}
		await addNightLoss(
			connection,
			secret,
			character.discordUserId,
			character.characterId,
			'ability',
			expended.block_slug,
			expended.name,
			correctionReason,
			expended.levels
		);
	}
}
