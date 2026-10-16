import { describe, it, expect } from 'vitest';
import { resolveDestination } from '../../src/notices/route.js';
import type { BotNotice } from '../../src/be/notices.js';
import type { ApprovedLinkForRouting } from '../../src/be/rooms.js';

function notice(wpUserId: number | null): BotNotice {
	return { id: 1, wp_user_id: wpUserId, kind: 'change_decided', payload: {}, created_at: '2026-10-16 00:00:00' };
}

describe('resolveDestination', () => {
	it('sends a staff notice to the staff channel regardless of any link', () => {
		expect(resolveDestination(notice(null), [])).toEqual({ kind: 'staff' });
	});

	it("sends a player notice to their own room when one is set", () => {
		const links: ApprovedLinkForRouting[] = [{ wp_user_id: 5, discord_user_id: 'd5', room_channel_id: 'c1' }];
		expect(resolveDestination(notice(5), links)).toEqual({ kind: 'room', channelId: 'c1' });
	});

	it('falls back to a direct message when the player has no room set', () => {
		const links: ApprovedLinkForRouting[] = [{ wp_user_id: 5, discord_user_id: 'd5', room_channel_id: null }];
		expect(resolveDestination(notice(5), links)).toEqual({ kind: 'dm', discordUserId: 'd5' });
	});

	it('is unroutable when the named player has no approved link at all', () => {
		expect(resolveDestination(notice(5), [])).toEqual({ kind: 'unroutable' });
	});
});
