export type Gesture = 'rock' | 'paper' | 'scissors' | 'bomb';
export type Category = 'physical' | 'social' | 'mental';
export type Side = 'challenger' | 'defender';
export type BidStage = 'claim' | 'negative_trait' | 'overbid';

export interface Terms {
	category: Category | null;
	conditions: string;
	appropriateTraits: string;
	/** Sources each side may retest with, and sources that block the other side's retest. */
	challengerSources: string[];
	defenderSources: string[];
	challengerBlockers: string[];
	defenderBlockers: string[];
}

export interface Claim {
	traitCount: number;
	hasBomb: boolean;
	retestSource: string | null;
	bidTrait: string;
}

export interface Bid {
	trait: string;
	stage: BidStage;
}

export interface SideState {
	claim: Claim | null;
	bids: Bid[];
	usedSources: string[];
	usedBlockers: string[];
	gesture: Gesture | null;
}

export interface ThrowRecord {
	challengerGesture: Gesture;
	defenderGesture: Gesture;
	winner: Side | 'draw';
	brokenByCount: boolean;
	kind: 'initial' | 'overbid' | 'retest';
	retestBy?: Side;
	blocked?: boolean;
}

export interface NegativeTraitCall {
	trait: string;
	correct: boolean;
}

export interface Outcome {
	loser: Side | 'both';
	lostTraits: string[];
	expendedAbilities: string[];
}

export interface ChallengeState {
	terms: Terms;
	challenger: SideState;
	defender: SideState;
	negativeTrait: NegativeTraitCall | null;
	throws: ThrowRecord[];
	outcome: Outcome | null;
}

const emptySide = (): SideState => ({ claim: null, bids: [], usedSources: [], usedBlockers: [], gesture: null });

export function emptyState(terms: Terms): ChallengeState {
	return { terms, challenger: emptySide(), defender: emptySide(), negativeTrait: null, throws: [], outcome: null };
}

export function otherSide(side: Side): Side {
	return side === 'challenger' ? 'defender' : 'challenger';
}

export type ClaimResult = { ok: true } | { ok: false; reason: 'over_cap' };

/**
 * Whether a claimed Trait count is allowed under the chronicle's own cap - the one real limit the
 * engine enforces on a claim, since everything else a claim carries is the table's own honesty.
 */
export function validateClaim(claim: Claim, traitCap: number): ClaimResult {
	if (claim.traitCount > traitCap) {
		return { ok: false, reason: 'over_cap' };
	}
	return { ok: true };
}

export function submitClaim(state: ChallengeState, side: Side, claim: Claim): ChallengeState {
	const next = cloneState(state);
	next[side].claim = claim;
	next[side].bids.push({ trait: claim.bidTrait, stage: 'claim' });
	return next;
}

export type GestureResult = { ok: true } | { ok: false; reason: 'bomb_not_claimed' };

/**
 * A side may only throw the bomb when it claimed holding one. Any other gesture is always open.
 */
export function validateGesture(state: ChallengeState, side: Side, gesture: Gesture): GestureResult {
	if (gesture === 'bomb' && state[side].claim?.hasBomb !== true) {
		return { ok: false, reason: 'bomb_not_claimed' };
	}
	return { ok: true };
}

/**
 * Rock beats Scissors, Scissors beats Paper, Paper beats Rock. The bomb beats Rock and Paper, loses
 * to Scissors, and ties another bomb. Identical ordinary gestures tie.
 */
export function resolveGestures(challengerGesture: Gesture, defenderGesture: Gesture): Side | 'draw' {
	if (challengerGesture === defenderGesture) {
		return 'draw';
	}
	if (challengerGesture === 'bomb') {
		return defenderGesture === 'scissors' ? 'defender' : 'challenger';
	}
	if (defenderGesture === 'bomb') {
		return challengerGesture === 'scissors' ? 'challenger' : 'defender';
	}
	const challengerBeats: Record<Exclude<Gesture, 'bomb'>, Exclude<Gesture, 'bomb'>> = {
		rock: 'scissors',
		scissors: 'paper',
		paper: 'rock',
	};
	return challengerBeats[challengerGesture as Exclude<Gesture, 'bomb'>] === defenderGesture ? 'challenger' : 'defender';
}

/**
 * The running Trait total each side has bid so far - what a tied throw's claimed counts are
 * actually compared against, not the original claim alone.
 */
export function bidTotal(side: SideState): number {
	return side.bids.length;
}

/**
 * Settles a tie by the claimed Trait counts: the challenger's is revealed first, the lower count
 * loses, and an equal count is a draw.
 */
export function breakTieByCount(challengerCount: number, defenderCount: number): Side | 'draw' {
	if (challengerCount === defenderCount) {
		return 'draw';
	}
	return challengerCount > defenderCount ? 'challenger' : 'defender';
}

/**
 * Throws both gestures and, on a tie, breaks it by the running bid totals. A draw costs both sides
 * and ends the challenge with no overbid or retest offered.
 */
export function throwGestures(
	state: ChallengeState,
	challengerGesture: Gesture,
	defenderGesture: Gesture,
	kind: ThrowRecord['kind'] = 'initial',
	retestBy?: Side
): ChallengeState {
	const next = cloneState(state);
	const gestureResult = resolveGestures(challengerGesture, defenderGesture);
	let winner: Side | 'draw' = gestureResult;
	let brokenByCount = false;
	if (gestureResult === 'draw') {
		winner = breakTieByCount(bidTotal(next.challenger), bidTotal(next.defender));
		brokenByCount = true;
	}
	next.challenger.gesture = challengerGesture;
	next.defender.gesture = defenderGesture;
	const record: ThrowRecord = { challengerGesture, defenderGesture, winner, brokenByCount, kind };
	if (retestBy !== undefined) {
		record.retestBy = retestBy;
	}
	next.throws.push(record);
	return next;
}

export function latestThrow(state: ChallengeState): ThrowRecord | null {
	return state.throws[state.throws.length - 1] ?? null;
}

/**
 * The side that lost the most recent throw, or null for a draw - a draw has no loser to overbid or
 * retest, it is already final.
 */
export function currentLoser(state: ChallengeState): Side | null {
	const last = latestThrow(state);
	if (!last || last.winner === 'draw') {
		return null;
	}
	return otherSide(last.winner);
}

export type OverbidResult = { ok: true } | { ok: false; reason: 'count_too_low' } | { ok: false; reason: 'no_loser' };

/**
 * An overbid's claimed count must be at least double the winner's own claimed count - anything less
 * is refused before a second throw is ever offered.
 */
export function validateOverbid(state: ChallengeState, overbidCount: number): OverbidResult {
	const last = latestThrow(state);
	if (!last || last.winner === 'draw') {
		return { ok: false, reason: 'no_loser' };
	}
	const winnerCount = bidTotal(state[last.winner]);
	if (overbidCount < winnerCount * 2) {
		return { ok: false, reason: 'count_too_low' };
	}
	return { ok: true };
}

export function submitOverbid(state: ChallengeState, side: Side, trait: string): ChallengeState {
	const next = cloneState(state);
	next[side].bids.push({ trait, stage: 'overbid' });
	return next;
}

export type RetestResult = { ok: true } | { ok: false; reason: 'source_already_used' } | { ok: false; reason: 'source_not_claimed' };

/**
 * A retest must use one of the side's own terms-declared sources, never the same source twice in
 * one challenge.
 */
export function validateRetest(state: ChallengeState, side: Side, source: string): RetestResult {
	const declared = side === 'challenger' ? state.terms.challengerSources : state.terms.defenderSources;
	if (!declared.includes(source)) {
		return { ok: false, reason: 'source_not_claimed' };
	}
	if (state[side].usedSources.includes(source)) {
		return { ok: false, reason: 'source_already_used' };
	}
	return { ok: true };
}

export function spendRetestSource(state: ChallengeState, side: Side, source: string): ChallengeState {
	const next = cloneState(state);
	next[side].usedSources.push(source);
	return next;
}

export type BlockResult = { ok: true } | { ok: false; reason: 'blocker_already_used' } | { ok: false; reason: 'blocker_not_claimed' };

/**
 * A block must use one of the blocking side's own declared blocking sources, never the same one
 * twice.
 */
export function validateBlock(state: ChallengeState, blockingSide: Side, blocker: string): BlockResult {
	const declared = blockingSide === 'challenger' ? state.terms.challengerBlockers : state.terms.defenderBlockers;
	if (!declared.includes(blocker)) {
		return { ok: false, reason: 'blocker_not_claimed' };
	}
	if (state[blockingSide].usedBlockers.includes(blocker)) {
		return { ok: false, reason: 'blocker_already_used' };
	}
	return { ok: true };
}

export function spendBlocker(state: ChallengeState, blockingSide: Side, blocker: string): ChallengeState {
	const next = cloneState(state);
	next[blockingSide].usedBlockers.push(blocker);
	return next;
}

/**
 * Records a blocked retest - the prior result stands, nothing about the outcome changes, only the
 * attempt and the spent sources are on record.
 */
export function recordBlockedRetest(state: ChallengeState, retestBy: Side): ChallengeState {
	const next = cloneState(state);
	const prior = latestThrow(next);
	if (!prior) {
		return next;
	}
	next.throws.push({ ...prior, kind: 'retest', retestBy, blocked: true });
	return next;
}

/**
 * Calls one of the opponent's Negative Traits. A correct call forces the opponent to bid one more
 * Trait or relent; a wrong call costs the challenger a bid instead.
 */
export function callNegativeTrait(state: ChallengeState, trait: string, correct: boolean): ChallengeState {
	const next = cloneState(state);
	next.negativeTrait = { trait, correct };
	if (!correct) {
		next.challenger.bids.push({ trait, stage: 'negative_trait' });
	}
	return next;
}

export function bidNegativeTraitResponse(state: ChallengeState, trait: string): ChallengeState {
	const next = cloneState(state);
	next.defender.bids.push({ trait, stage: 'negative_trait' });
	return next;
}

/**
 * The final outcome from the most recent throw: the loser's every bid Trait across every stage, and
 * every retest source it actually spent (unblocked) that is an Ability - the only source kind this
 * engine ever expends, since a non-Ability retest source costs nothing by the design's own rule.
 */
export function settle(state: ChallengeState, loserAbilitySources: string[] = []): Outcome {
	const last = latestThrow(state);
	if (!last) {
		return { loser: 'both', lostTraits: [], expendedAbilities: [] };
	}
	if (last.winner === 'draw') {
		return {
			loser: 'both',
			lostTraits: [...state.challenger.bids.map((b) => b.trait), ...state.defender.bids.map((b) => b.trait)],
			expendedAbilities: [],
		};
	}
	const loser = otherSide(last.winner);
	const expended = state[loser].usedSources.filter((source) => loserAbilitySources.includes(source));
	return { loser, lostTraits: state[loser].bids.map((b) => b.trait), expendedAbilities: expended };
}

function cloneState(state: ChallengeState): ChallengeState {
	return {
		terms: state.terms,
		challenger: { ...state.challenger, bids: [...state.challenger.bids], usedSources: [...state.challenger.usedSources], usedBlockers: [...state.challenger.usedBlockers] },
		defender: { ...state.defender, bids: [...state.defender.bids], usedSources: [...state.defender.usedSources], usedBlockers: [...state.defender.usedBlockers] },
		negativeTrait: state.negativeTrait,
		throws: [...state.throws],
		outcome: state.outcome,
	};
}
