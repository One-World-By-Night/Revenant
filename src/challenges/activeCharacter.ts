import type { Pool } from 'pg';
import { callBe } from '../be/client.js';
import type { Connection } from '../be/temporaryState.js';

export interface ActiveCharacter {
	id: number;
	name: string;
}

interface LookupResponse {
	characters: ActiveCharacter[];
}

/**
 * The active character a given Discord user is currently playing, resolved the same way `/character`
 * resolves the caller's own - their linked list intersected with their stored active pick - but for
 * any Discord user, not only the one invoking the command.
 */
export async function activeCharacterFor(
	pool: Pool,
	connection: Connection,
	secret: Buffer,
	guildId: string,
	discordUserId: string
): Promise<ActiveCharacter | null> {
	const lookup = await callBe<LookupResponse>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/bot/links/${discordUserId}`,
		signedAs: { connectionId: String(connection.be_connection_id), secret },
	});
	if (lookup.characters.length === 0) {
		return null;
	}

	const prefs = await pool.query<{ active_character_id: number | null }>(
		'SELECT active_character_id FROM user_prefs WHERE guild_id = $1 AND discord_user_id = $2',
		[guildId, discordUserId]
	);
	const activeId = prefs.rows[0]?.active_character_id ?? null;
	const active = activeId !== null ? lookup.characters.find((character) => character.id === activeId) : undefined;
	return active ?? lookup.characters[0] ?? null;
}
