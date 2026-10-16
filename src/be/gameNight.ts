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
	// BE's own JSON serializes a numeric id as a string; every caller comparing by id needs a real number.
	result.plots.forEach((plot) => {
		plot.id = Number(plot.id);
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

export interface PlotSearchResult {
	id: number;
	title: string;
}

/**
 * Plots matching a title search, exactly as the chronicle's own authorization already scopes them -
 * everything for a Storyteller, only what the searching player's own audience lets them see otherwise.
 */
export async function searchPlots(connection: Connection, secret: Buffer, discordUserId: string, search: string): Promise<PlotSearchResult[]> {
	const result = await callBe<PlotSearchResult[]>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/plots`,
		query: { search, per_page: '25' },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
	result.forEach((plot) => {
		plot.id = Number(plot.id);
	});
	return result;
}

export interface PlotEntryRow {
	id: number;
	entry_type: string;
	content: string;
	event_date: string | null;
	created_at: string;
}

export interface PlotWithEntries {
	id: number;
	title: string;
	status: string;
	game_date: string | null;
	entries: PlotEntryRow[];
}

/**
 * One plot's own entries, exactly as BE's `GET /plots/{id}` already resolves them for the caller - a
 * note entry hidden from a non-manager, a plot outside the caller's own audience refused as not found.
 */
export async function fetchPlotWithEntries(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	plotId: number
): Promise<PlotWithEntries> {
	const result = await callBe<PlotWithEntries>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/plots/${plotId}`,
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
	result.id = Number(result.id);
	return result;
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
