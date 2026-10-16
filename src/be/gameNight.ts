import { callBe } from './client.js';
import type { Connection } from './temporaryState.js';

export interface AttendanceRow {
	id: number;
	session_id: number;
	character_id: number | null;
}

export async function checkIn(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	sessionId: number,
	characterId: number
): Promise<AttendanceRow> {
	return callBe<AttendanceRow>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/sessions/${sessionId}/check-in`,
		body: { character_id: characterId },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

export interface AfterGameReport {
	id: number;
	session_id: number;
	character_id: number;
}

export async function createReport(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	sessionId: number,
	characterId: number,
	fields: { did: string; wants: string; toStaff: string }
): Promise<AfterGameReport> {
	return callBe<AfterGameReport>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/sessions/${sessionId}/reports`,
		body: {
			character_id: characterId,
			did: fields.did === '' ? null : fields.did,
			wants: fields.wants === '' ? null : fields.wants,
			to_staff: fields.toStaff === '' ? null : fields.toStaff,
		},
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

export interface MyPlot {
	id: number;
	title: string;
	is_action_allocation: boolean;
	game_date: string | null;
}

export async function fetchMyPlots(connection: Connection, secret: Buffer, discordUserId: string): Promise<MyPlot[]> {
	const result = await callBe<{ plots: MyPlot[] }>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/my/plots`,
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
	return result.plots;
}

/**
 * The plots a player can post a downtime action to - their own action-allocation plots only, the
 * same narrowing a bot needs before it can offer them as `/downtime` choices.
 */
export function downtimePlots(plots: MyPlot[]): MyPlot[] {
	return plots.filter((plot) => plot.is_action_allocation);
}

export interface PlotEntry {
	id: number;
	plot_id: number;
	entry_type: string;
	content: string;
}

export async function postAction(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	plotId: number,
	content: string
): Promise<PlotEntry> {
	return callBe<PlotEntry>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/plots/${plotId}/entries`,
		body: { entry_type: 'action', content },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

export async function postScene(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	plotId: number,
	content: string
): Promise<PlotEntry> {
	return callBe<PlotEntry>(connection.rest_root, {
		method: 'POST',
		route: `/be/v1/${connection.game_slug}/plots/${plotId}/entries`,
		body: { entry_type: 'scene', content },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}
