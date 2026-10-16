import { callBe } from './client.js';
import type { Connection } from './temporaryState.js';

export interface BotNotice {
	id: number;
	wp_user_id: number | null;
	kind: string;
	payload: Record<string, unknown>;
	created_at: string;
}

/**
 * A chronicle's own undelivered notices, oldest first - a staff-wide notice carries a null
 * `wp_user_id`, a player one carries that player's own WP user id.
 */
export async function fetchNotices(connection: Connection, secret: Buffer): Promise<BotNotice[]> {
	return callBe<BotNotice[]>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/bot/notices`,
		signedAs: { connectionId: String(connection.be_connection_id), secret },
	});
}

/**
 * Marks the given notice ids delivered, so the next poll doesn't see them again.
 */
export async function ackNotices(connection: Connection, secret: Buffer, ids: number[]): Promise<void> {
	if (ids.length === 0) {
		return;
	}
	await callBe<unknown>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/bot/notices/ack`,
		body: { ids },
		signedAs: { connectionId: String(connection.be_connection_id), secret },
	});
}
