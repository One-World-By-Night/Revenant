import { callBe } from './client.js';
import type { Connection } from './temporaryState.js';

export interface ApprovedLink {
	id: number;
	discord_user_id: string;
	discord_username: string;
	room_channel_id: string | null;
}

export interface ApprovedLinkForRouting {
	wp_user_id: number;
	discord_user_id: string;
	room_channel_id: string | null;
}

/**
 * Every approved link in this chronicle, with no acting Discord user - the bot's own routing needs
 * this regardless of whether any particular Storyteller is doing anything at the moment.
 */
export async function fetchApprovedLinksForRouting(connection: Connection, secret: Buffer): Promise<ApprovedLinkForRouting[]> {
	return callBe<ApprovedLinkForRouting[]>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/bot/approved-links`,
		signedAs: { connectionId: String(connection.be_connection_id), secret },
	});
}

/**
 * Every approved Discord link for this chronicle, each carrying its own room channel when one is set.
 */
export async function fetchApprovedLinks(connection: Connection, secret: Buffer, discordUserId: string): Promise<ApprovedLink[]> {
	return callBe<ApprovedLink[]>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/discord-links`,
		query: { status: 'approved' },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

/**
 * Points an approved link's room at a Discord channel, or clears it with a null channel id.
 */
export async function setRoom(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	linkId: number,
	channelId: string | null
): Promise<void> {
	await callBe<unknown>(connection.rest_root, {
		method: 'PUT',
		route: `/be/v1/${connection.game_slug}/discord-links/${linkId}/room`,
		body: { channel_id: channelId },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

export interface TargetCapabilities {
	be_manage_characters: boolean;
	be_manage_plots: boolean;
}

/**
 * The target Discord user's own BE capabilities, signed as them - what `/room` uses to decide which
 * single role (Player, Narrator or Storyteller) role sync gives them.
 */
export async function fetchCapabilitiesFor(connection: Connection, secret: Buffer, targetDiscordUserId: string): Promise<TargetCapabilities> {
	const result = await callBe<{ capabilities: Record<string, boolean> }>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/my/capabilities`,
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: targetDiscordUserId },
	});
	return {
		be_manage_characters: Boolean(result.capabilities.be_manage_characters),
		be_manage_plots: Boolean(result.capabilities.be_manage_plots),
	};
}

/**
 * Which one role sync gives a linked Discord user, from their own real BE capabilities - a Storyteller
 * role for anyone holding `be_manage_characters`, a Narrator role for `be_manage_plots` alone, a plain
 * Player role otherwise.
 */
export function roleForCapabilities(capabilities: TargetCapabilities): 'storyteller' | 'narrator' | 'player' {
	if (capabilities.be_manage_characters) {
		return 'storyteller';
	}
	if (capabilities.be_manage_plots) {
		return 'narrator';
	}
	return 'player';
}
