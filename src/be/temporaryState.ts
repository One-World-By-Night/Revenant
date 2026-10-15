import { callBe, BeApiError } from './client.js';

export type WoundType = 'bashing' | 'lethal' | 'aggravated';

export interface Wounds {
	bashing: number;
	lethal: number;
	aggravated: number;
}

export interface NightLossTrait {
	block_slug: string;
	name: string;
}

export interface NightLossAbility {
	block_slug: string;
	name: string;
	levels: number;
}

export interface NightLosses {
	lost_traits: NightLossTrait[];
	expended_abilities: NightLossAbility[];
}

export interface PoolAdjustResult {
	permanent: number;
	temporary: number;
}

export interface CharacterRaw {
	id: number;
	name: string;
	sheet_data: Record<string, unknown>;
}

export interface SessionRow {
	id: number;
	game_date: string;
	closed_at: string | null;
}

export interface DiscoveredPool {
	blockSlug: string;
	poolName: string;
	permanent: number;
	temporary: number;
}

export interface Connection {
	be_connection_id: number;
	rest_root: string;
	game_slug: string;
}

function isPoolShape(value: unknown): value is { permanent: number; temporary: number } {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return typeof candidate.permanent === 'number' && typeof candidate.temporary === 'number';
}

/**
 * Every `{permanent, temporary}` pair anywhere in a character's decoded sheet data, under whatever
 * block and pool name it's actually held - no creature-specific field names, matching BE's own engine
 * pattern (a resource pool is any such pair, wherever it's held).
 */
export function discoverPools(sheetData: Record<string, unknown>): DiscoveredPool[] {
	const found: DiscoveredPool[] = [];
	for (const [blockSlug, block] of Object.entries(sheetData)) {
		if (typeof block !== 'object' || block === null) {
			continue;
		}
		for (const [poolName, value] of Object.entries(block as Record<string, unknown>)) {
			if (isPoolShape(value)) {
				found.push({ blockSlug, poolName, permanent: value.permanent, temporary: value.temporary });
			}
		}
	}
	return found;
}

/**
 * A character's decoded wound state, or all zeros when the character has never been wounded.
 */
export function readWounds(sheetData: Record<string, unknown>): Wounds {
	const raw = sheetData._wound_state as Partial<Wounds> | undefined;
	return {
		bashing: raw?.bashing ?? 0,
		lethal: raw?.lethal ?? 0,
		aggravated: raw?.aggravated ?? 0,
	};
}

/**
 * A character's decoded night losses, or an empty pair of lists when nothing has been lost tonight.
 */
export function readNightLosses(sheetData: Record<string, unknown>): NightLosses {
	const raw = sheetData._night_losses as Partial<NightLosses> | undefined;
	return {
		lost_traits: raw?.lost_traits ?? [],
		expended_abilities: raw?.expended_abilities ?? [],
	};
}

/**
 * The character named in the route, with its raw, decoded sheet data - the same call `/status` and
 * pool resolution both read from.
 */
export async function fetchCharacterRaw(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	characterId: number
): Promise<CharacterRaw> {
	return callBe<CharacterRaw>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/characters/${characterId}`,
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

/**
 * Spends (negative delta) or regains (positive delta) a point of one held resource pool's temporary
 * rating.
 */
export async function adjustPool(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	characterId: number,
	blockSlug: string,
	poolName: string,
	delta: number,
	reason: string
): Promise<PoolAdjustResult> {
	return callBe<PoolAdjustResult>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/characters/${characterId}/temporary/pool`,
		body: { block_slug: blockSlug, pool_name: poolName, delta, reason },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

/**
 * Takes damage of one type. The caller folds any armor amount into `reason` before calling this - the
 * bot does no armor math of its own.
 */
export async function takeWound(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	characterId: number,
	type: WoundType,
	amount: number,
	reason: string
): Promise<Wounds> {
	const result = await callBe<{ wounds: Wounds }>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/characters/${characterId}/wound`,
		body: { type, amount, reason },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
	return result.wounds;
}

export async function healWound(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	characterId: number,
	type: WoundType,
	amount: number
): Promise<Wounds> {
	const result = await callBe<{ wounds: Wounds }>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/characters/${characterId}/heal`,
		body: { type, amount },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
	return result.wounds;
}

/**
 * Finds a session already open for today's date, in the chronicle's own site timezone, or null when
 * none exists yet.
 */
export async function findSessionForDate(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	date: string
): Promise<SessionRow | null> {
	const sessions = await callBe<SessionRow[]>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/sessions`,
		query: { from: date, to: date },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
	return sessions[0] ?? null;
}

/**
 * Whether a pool adjustment came back clamped - BE's own `[0, permanent]` clamp applied and the
 * pool's temporary rating moved by less than the requested delta.
 */
export function wasClamped(before: number, delta: number, after: number): boolean {
	return after !== before + delta;
}

export class SessionAlreadyExistsError extends Error {
	constructor() {
		super('A session already exists for that date');
		this.name = 'SessionAlreadyExistsError';
	}
}

/**
 * Creates a session for the given date. Throws `SessionAlreadyExistsError` on BE's own 409
 * `duplicate_date` - the caller should re-read with `findSessionForDate` rather than treat this as a
 * real failure, since another Storyteller opening the same night a moment earlier is not an error.
 */
export async function createSession(connection: Connection, secret: Buffer, discordUserId: string, date: string): Promise<SessionRow> {
	try {
		return await callBe<SessionRow>(connection.rest_root, {
			method: 'POST',
			route: `/be/v1/${connection.game_slug}/sessions`,
			body: { game_date: date },
			signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
		});
	} catch (error) {
		if (error instanceof BeApiError && error.beCode === 'duplicate_date') {
			throw new SessionAlreadyExistsError();
		}
		throw error;
	}
}

export async function closeSession(connection: Connection, secret: Buffer, discordUserId: string, sessionId: number): Promise<void> {
	await callBe<unknown>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/sessions/${sessionId}/close`,
		body: {},
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}
