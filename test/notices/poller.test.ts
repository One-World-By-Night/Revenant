import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import type { Pool } from 'pg';
import type { Config } from '../../src/config.js';
import type { Logger } from '../../src/log.js';
import type { BotNotice } from '../../src/be/notices.js';

vi.mock('../../src/be/notices.js', () => ({ fetchNotices: vi.fn(), ackNotices: vi.fn() }));
vi.mock('../../src/be/rooms.js', () => ({ fetchApprovedLinksForRouting: vi.fn() }));
vi.mock('../../src/crypto/secretBox.js', () => ({ decrypt: vi.fn(() => Buffer.alloc(32, 1)) }));

const { fetchNotices, ackNotices } = await import('../../src/be/notices.js');
const { fetchApprovedLinksForRouting } = await import('../../src/be/rooms.js');
const { pollGuild, startNoticePoller } = await import('../../src/notices/poller.js');

const fetchNoticesMock = vi.mocked(fetchNotices);
const ackNoticesMock = vi.mocked(ackNotices);
const linksMock = vi.mocked(fetchApprovedLinksForRouting);

const config = { secretKey: Buffer.alloc(32, 2), eventPollSeconds: 30 } as unknown as Config;
const logger = { warn: vi.fn(), info: vi.fn() } as unknown as Logger;

function row(guildId: string) {
	return { guild_id: guildId, be_connection_id: 1, secret_enc: Buffer.alloc(8), rest_root: 'https://example.test/wp-json/', game_slug: 'kony' };
}

function notice(id: number, wpUserId: number | null = 77): BotNotice {
	return {
		id,
		wp_user_id: wpUserId,
		kind: 'change_decided',
		payload: { character_name: 'Test Character', label: 'experience', status: 'approved' },
		created_at: '2026-10-19 18:12:59',
	};
}

/**
 * A pool that answers the poller's own queries from memory: the claim insert, the guild settings read, and the
 * connections list.
 */
function fakePool(connections: ReturnType<typeof row>[] = []) {
	const claimed = new Set<string>();
	const query = vi.fn(async (sql: string, params: unknown[] = []) => {
		if (sql.startsWith('INSERT INTO delivered_notices')) {
			const key = `${String(params[0])}:${String(params[1])}`;
			if (claimed.has(key)) {
				return { rowCount: 0, rows: [] };
			}
			claimed.add(key);
			return { rowCount: 1, rows: [] };
		}
		if (sql.startsWith('SELECT staff_channel_id')) {
			return { rowCount: 0, rows: [] };
		}
		if (sql.startsWith('SELECT guild_id, be_connection_id')) {
			return { rowCount: connections.length, rows: connections };
		}
		throw new Error(`unexpected query: ${sql}`);
	});
	return { pool: { query } as unknown as Pool, claimed };
}

function fakeClient() {
	const dmSend = vi.fn(async () => undefined);
	const client = {
		users: { fetch: vi.fn(async () => ({ send: dmSend })) },
		channels: { fetch: vi.fn(async () => null) },
	} as unknown as Client;
	return { client, dmSend };
}

beforeEach(() => {
	fetchNoticesMock.mockReset();
	ackNoticesMock.mockReset();
	linksMock.mockReset();
	linksMock.mockResolvedValue([{ wp_user_id: 77, discord_user_id: '750141541762334811', room_channel_id: null }]);
	ackNoticesMock.mockResolvedValue(undefined);
});

describe('pollGuild', () => {
	it('posts a notice once however many polls return it, and acknowledges it every time', async () => {
		const { pool } = fakePool();
		const { client, dmSend } = fakeClient();
		fetchNoticesMock.mockResolvedValue([notice(2)]);

		for (let poll = 0; poll < 5; poll++) {
			await pollGuild(client, pool, config, logger, row('111111111111111111'));
		}

		expect(dmSend).toHaveBeenCalledTimes(1);
		expect(dmSend).toHaveBeenCalledWith(expect.stringContaining('Test Character'));
		expect(ackNoticesMock).toHaveBeenCalledTimes(5);
		for (const call of ackNoticesMock.mock.calls) {
			expect(call[2]).toEqual([2]);
		}
	});

	it('posts a new notice that arrives beside one already posted', async () => {
		const { pool } = fakePool();
		const { client, dmSend } = fakeClient();
		fetchNoticesMock.mockResolvedValueOnce([notice(2)]).mockResolvedValueOnce([notice(2), notice(9)]);

		await pollGuild(client, pool, config, logger, row('111111111111111111'));
		await pollGuild(client, pool, config, logger, row('111111111111111111'));

		expect(dmSend).toHaveBeenCalledTimes(2);
		expect(ackNoticesMock.mock.calls[1]?.[2]).toEqual([2, 9]);
	});

	it('keeps each guild to its own notices', async () => {
		const { pool, claimed } = fakePool();
		const { client, dmSend } = fakeClient();
		fetchNoticesMock.mockResolvedValue([notice(1)]);

		await pollGuild(client, pool, config, logger, row('111111111111111111'));
		await pollGuild(client, pool, config, logger, row('222222222222222222'));

		expect(dmSend).toHaveBeenCalledTimes(2);
		expect([...claimed].sort()).toEqual(['111111111111111111:1', '222222222222222222:1']);
	});
});

describe('startNoticePoller', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it('never starts a guild poll while its last one is still running', async () => {
		const { pool } = fakePool([row('111111111111111111')]);
		const { client } = fakeClient();
		let release: (value: BotNotice[]) => void = () => undefined;
		fetchNoticesMock.mockImplementation(
			() =>
				new Promise<BotNotice[]>((resolve) => {
					release = resolve;
				})
		);

		startNoticePoller(client, pool, config, logger);
		await vi.advanceTimersByTimeAsync(30_000);
		await vi.advanceTimersByTimeAsync(30_000);
		await vi.advanceTimersByTimeAsync(30_000);

		expect(fetchNoticesMock).toHaveBeenCalledTimes(1);

		release([]);
		await vi.advanceTimersByTimeAsync(30_000);

		expect(fetchNoticesMock).toHaveBeenCalledTimes(2);
	});
});
