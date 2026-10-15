import { describe, it, expect } from 'vitest';
import {
	emptyState,
	validateClaim,
	submitClaim,
	validateGesture,
	resolveGestures,
	breakTieByCount,
	throwGestures,
	currentLoser,
	validateOverbid,
	submitOverbid,
	validateRetest,
	spendRetestSource,
	validateBlock,
	spendBlocker,
	recordBlockedRetest,
	callNegativeTrait,
	bidNegativeTraitResponse,
	settle,
	settleRelent,
	otherSide,
	type Terms,
	type Claim,
} from '../../src/challenges/engine.js';

function terms(overrides: Partial<Terms> = {}): Terms {
	return {
		category: 'physical',
		conditions: 'I swing my sword at you',
		appropriateTraits: 'Strength, Melee',
		challengerSources: ['Melee'],
		defenderSources: ['Dodge'],
		challengerBlockers: ['Alertness'],
		defenderBlockers: ['Intimidation'],
		...overrides,
	};
}

function claim(overrides: Partial<Claim> = {}): Claim {
	return { traitCount: 3, hasBomb: false, retestSource: null, bidTrait: 'Brawn', ...overrides };
}

describe('otherSide', () => {
	it('flips challenger and defender', () => {
		expect(otherSide('challenger')).toBe('defender');
		expect(otherSide('defender')).toBe('challenger');
	});
});

describe('validateClaim', () => {
	it('allows a count at or under the cap', () => {
		expect(validateClaim(claim({ traitCount: 5 }), 5)).toEqual({ ok: true });
	});

	it('refuses a count over the cap', () => {
		expect(validateClaim(claim({ traitCount: 6 }), 5)).toEqual({ ok: false, reason: 'over_cap' });
	});
});

describe('submitClaim', () => {
	it('records the claim and its bid Trait', () => {
		const state = submitClaim(emptyState(terms()), 'challenger', claim());
		expect(state.challenger.claim).toEqual(claim());
		expect(state.challenger.bids).toEqual([{ trait: 'Brawn', stage: 'claim' }]);
	});

	it('never mutates the state it was given', () => {
		const before = emptyState(terms());
		submitClaim(before, 'challenger', claim());
		expect(before.challenger.claim).toBeNull();
	});
});

describe('validateGesture', () => {
	it('refuses the bomb when it was never claimed', () => {
		const state = submitClaim(emptyState(terms()), 'challenger', claim({ hasBomb: false }));
		expect(validateGesture(state, 'challenger', 'bomb')).toEqual({ ok: false, reason: 'bomb_not_claimed' });
	});

	it('allows the bomb when it was claimed', () => {
		const state = submitClaim(emptyState(terms()), 'challenger', claim({ hasBomb: true }));
		expect(validateGesture(state, 'challenger', 'bomb')).toEqual({ ok: true });
	});

	it('always allows an ordinary gesture', () => {
		const state = emptyState(terms());
		expect(validateGesture(state, 'challenger', 'rock')).toEqual({ ok: true });
	});
});

describe('resolveGestures', () => {
	it('rock beats scissors', () => {
		expect(resolveGestures('rock', 'scissors')).toBe('challenger');
		expect(resolveGestures('scissors', 'rock')).toBe('defender');
	});

	it('scissors beats paper', () => {
		expect(resolveGestures('scissors', 'paper')).toBe('challenger');
		expect(resolveGestures('paper', 'scissors')).toBe('defender');
	});

	it('paper beats rock', () => {
		expect(resolveGestures('paper', 'rock')).toBe('challenger');
		expect(resolveGestures('rock', 'paper')).toBe('defender');
	});

	it('identical ordinary gestures tie', () => {
		expect(resolveGestures('rock', 'rock')).toBe('draw');
		expect(resolveGestures('paper', 'paper')).toBe('draw');
		expect(resolveGestures('scissors', 'scissors')).toBe('draw');
	});

	it('the bomb beats rock and paper', () => {
		expect(resolveGestures('bomb', 'rock')).toBe('challenger');
		expect(resolveGestures('bomb', 'paper')).toBe('challenger');
		expect(resolveGestures('rock', 'bomb')).toBe('defender');
		expect(resolveGestures('paper', 'bomb')).toBe('defender');
	});

	it('the bomb loses to scissors', () => {
		expect(resolveGestures('bomb', 'scissors')).toBe('defender');
		expect(resolveGestures('scissors', 'bomb')).toBe('challenger');
	});

	it('a bomb against a bomb ties', () => {
		expect(resolveGestures('bomb', 'bomb')).toBe('draw');
	});
});

describe('breakTieByCount', () => {
	it('the higher count wins', () => {
		expect(breakTieByCount(5, 3)).toBe('challenger');
		expect(breakTieByCount(3, 5)).toBe('defender');
	});

	it('an equal count is a draw', () => {
		expect(breakTieByCount(4, 4)).toBe('draw');
	});
});

describe('throwGestures', () => {
	it('records a plain win with no count break', () => {
		const state = throwGestures(emptyState(terms()), 'rock', 'scissors');
		expect(state.throws).toEqual([{ challengerGesture: 'rock', defenderGesture: 'scissors', winner: 'challenger', brokenByCount: false, kind: 'initial', retestBy: undefined }]);
	});

	it('breaks a gesture tie by the running bid totals', () => {
		let state = emptyState(terms());
		state = submitClaim(state, 'challenger', claim({ bidTrait: 'Brawn' }));
		state = submitClaim(state, 'defender', claim({ bidTrait: 'Grace' }));
		state = throwGestures(state, 'rock', 'rock');
		expect(latestThrowWinner(state)).toBe('draw');
	});

	it('an unequal running total breaks a gesture tie for the higher side', () => {
		let state = emptyState(terms());
		state = submitClaim(state, 'challenger', claim({ bidTrait: 'Brawn' }));
		state = submitOverbid(state, 'challenger', 'Fortitude');
		state = submitClaim(state, 'defender', claim({ bidTrait: 'Grace' }));
		state = throwGestures(state, 'paper', 'paper');
		const thrown = state.throws[0]!;
		expect(thrown.winner).toBe('challenger');
		expect(thrown.brokenByCount).toBe(true);
	});
});

function latestThrowWinner(state: ReturnType<typeof emptyState>) {
	return state.throws[state.throws.length - 1]!.winner;
}

describe('currentLoser', () => {
	it('is the side that lost the most recent throw', () => {
		const state = throwGestures(emptyState(terms()), 'rock', 'scissors');
		expect(currentLoser(state)).toBe('defender');
	});

	it('is null after a draw', () => {
		let state = emptyState(terms());
		state = throwGestures(state, 'rock', 'rock');
		expect(currentLoser(state)).toBeNull();
	});

	it('is null before any throw', () => {
		expect(currentLoser(emptyState(terms()))).toBeNull();
	});
});

describe('validateOverbid', () => {
	it('refuses a count below double the winners claimed total', () => {
		let state = emptyState(terms());
		state = submitClaim(state, 'challenger', claim({ bidTrait: 'Brawn' }));
		state = throwGestures(state, 'rock', 'scissors');
		expect(validateOverbid(state, 1)).toEqual({ ok: false, reason: 'count_too_low' });
	});

	it('allows a count at exactly double', () => {
		let state = emptyState(terms());
		state = submitClaim(state, 'challenger', claim({ bidTrait: 'Brawn' }));
		state = throwGestures(state, 'rock', 'scissors');
		expect(validateOverbid(state, 2)).toEqual({ ok: true });
	});

	it('refuses when the last throw was a draw', () => {
		const state = throwGestures(emptyState(terms()), 'rock', 'rock');
		expect(validateOverbid(state, 10)).toEqual({ ok: false, reason: 'no_loser' });
	});
});

describe('retest sources', () => {
	it('refuses a source the side never declared', () => {
		expect(validateRetest(emptyState(terms()), 'challenger', 'Science')).toEqual({ ok: false, reason: 'source_not_claimed' });
	});

	it('allows a declared, unused source', () => {
		expect(validateRetest(emptyState(terms()), 'challenger', 'Melee')).toEqual({ ok: true });
	});

	it('refuses a source already spent this challenge', () => {
		let state = emptyState(terms());
		state = spendRetestSource(state, 'challenger', 'Melee');
		expect(validateRetest(state, 'challenger', 'Melee')).toEqual({ ok: false, reason: 'source_already_used' });
	});
});

describe('blocking a retest', () => {
	it('refuses a blocker the side never declared', () => {
		expect(validateBlock(emptyState(terms()), 'defender', 'Melee')).toEqual({ ok: false, reason: 'blocker_not_claimed' });
	});

	it('allows a declared, unused blocker', () => {
		expect(validateBlock(emptyState(terms()), 'defender', 'Intimidation')).toEqual({ ok: true });
	});

	it('refuses a blocker already spent', () => {
		let state = emptyState(terms());
		state = spendBlocker(state, 'defender', 'Intimidation');
		expect(validateBlock(state, 'defender', 'Intimidation')).toEqual({ ok: false, reason: 'blocker_already_used' });
	});

	it('a blocked retest leaves the prior result standing', () => {
		let state = throwGestures(emptyState(terms()), 'rock', 'scissors');
		state = recordBlockedRetest(state, 'defender');
		const last = state.throws[state.throws.length - 1]!;
		expect(last.winner).toBe('challenger');
		expect(last.blocked).toBe(true);
		expect(last.kind).toBe('retest');
	});

	it('an unblocked retest throw replaces the result', () => {
		let state = throwGestures(emptyState(terms()), 'rock', 'scissors');
		state = throwGestures(state, 'scissors', 'rock', 'retest', 'defender');
		const last = state.throws[state.throws.length - 1]!;
		expect(last.winner).toBe('defender');
	});
});

describe('the Negative Trait call', () => {
	it('a correct call costs the defender a bid', () => {
		const state = callNegativeTrait(emptyState(terms()), 'Coward', true);
		const withBid = bidNegativeTraitResponse(state, 'Nerve');
		expect(withBid.defender.bids).toEqual([{ trait: 'Nerve', stage: 'negative_trait' }]);
		expect(withBid.negativeTrait).toEqual({ trait: 'Coward', correct: true });
	});

	it('a wrong call costs the challenger a bid instead', () => {
		const state = callNegativeTrait(emptyState(terms()), 'Coward', false);
		expect(state.challenger.bids).toEqual([{ trait: 'Coward', stage: 'negative_trait' }]);
		expect(state.defender.bids).toEqual([]);
	});
});

describe('settleRelent', () => {
	it('names the relenting side as the loser with nothing bid', () => {
		expect(settleRelent('defender')).toEqual({ loser: 'defender', lostTraits: [], expendedAbilities: [] });
	});
});

describe('settle', () => {
	it('the loser loses every bid Trait across every stage', () => {
		let state = emptyState(terms());
		state = submitClaim(state, 'defender', claim({ bidTrait: 'Grace' }));
		state = submitOverbid(state, 'defender', 'Fortitude');
		state = throwGestures(state, 'rock', 'scissors');
		const outcome = settle(state);
		expect(outcome.loser).toBe('defender');
		expect(outcome.lostTraits.sort()).toEqual(['Fortitude', 'Grace'].sort());
	});

	it('a used retest source that is an Ability is expended, a non-Ability one is not', () => {
		let state = emptyState(terms({ defenderSources: ['Dodge', 'Fortitude'] }));
		state = submitClaim(state, 'defender', claim({ bidTrait: 'Grace' }));
		state = throwGestures(state, 'rock', 'scissors');
		state = spendRetestSource(state, 'defender', 'Dodge');
		const outcome = settle(state, ['Dodge']);
		expect(outcome.expendedAbilities).toEqual(['Dodge']);
	});

	it('a draw costs both sides and names no retest sources', () => {
		let state = emptyState(terms());
		state = submitClaim(state, 'challenger', claim({ bidTrait: 'Brawn' }));
		state = submitClaim(state, 'defender', claim({ bidTrait: 'Grace' }));
		state = throwGestures(state, 'rock', 'rock');
		const outcome = settle(state);
		expect(outcome.loser).toBe('both');
		expect(outcome.lostTraits.sort()).toEqual(['Brawn', 'Grace'].sort());
		expect(outcome.expendedAbilities).toEqual([]);
	});

	it('is a no-op shape before any throw has happened', () => {
		const outcome = settle(emptyState(terms()));
		expect(outcome).toEqual({ loser: 'both', lostTraits: [], expendedAbilities: [] });
	});
});
