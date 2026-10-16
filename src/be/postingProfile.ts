import { callBe } from './client.js';
import type { Connection } from './temporaryState.js';

export interface PostingProfile {
	id: number;
	display_name: string;
	image_url: string | null;
	is_npc: boolean;
	profile_public: boolean;
}

/**
 * The minimal shape the bot needs to repost a message as a character: its Who's Who display name,
 * its resolved portrait, whether it's an NPC, and whether its profile reaches an ordinary Discord
 * reader - signed as the given Discord user, who must either own the character or hold
 * `be_manage_characters`.
 */
export async function fetchPostingProfile(
	connection: Connection,
	secret: Buffer,
	discordUserId: string,
	characterId: number
): Promise<PostingProfile> {
	return callBe<PostingProfile>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/characters/${characterId}/posting-profile`,
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}
