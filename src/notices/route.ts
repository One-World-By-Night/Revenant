import type { BotNotice } from '../be/notices.js';
import type { ApprovedLinkForRouting } from '../be/rooms.js';

export type NoticeDestination =
	| { kind: 'room'; channelId: string }
	| { kind: 'dm'; discordUserId: string }
	| { kind: 'staff' }
	| { kind: 'unroutable' };

/**
 * Where one notice should go - a staff notice always reaches the staff channel; a player notice
 * reaches their own room when one is set, otherwise a direct message; a player notice naming nobody
 * currently linked is unroutable, not a direct message to nobody.
 */
export function resolveDestination(notice: BotNotice, links: ApprovedLinkForRouting[]): NoticeDestination {
	if (notice.wp_user_id === null) {
		return { kind: 'staff' };
	}
	const link = links.find((candidate) => candidate.wp_user_id === notice.wp_user_id);
	if (!link) {
		return { kind: 'unroutable' };
	}
	return link.room_channel_id ? { kind: 'room', channelId: link.room_channel_id } : { kind: 'dm', discordUserId: link.discord_user_id };
}
