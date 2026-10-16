import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import {
	recordProxiedMessage,
	findProxiedMessage,
	setTrigger,
	clearTrigger,
	getTrigger,
	setLock,
	clearLock,
	getLockForChannel,
} from '../../src/posting/store.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool } = pg;

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:devpassword@localhost:55432/berevenant_test';
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');
const pool = new Pool({ connectionString: DATABASE_URL });

beforeAll(async () => {
	await pool.query('DROP SCHEMA public CASCADE');
	await pool.query('CREATE SCHEMA public');
	await runMigrations(pool, MIGRATIONS_DIR);
});

beforeEach(async () => {
	await pool.query('DELETE FROM proxied_messages');
	await pool.query('DELETE FROM posting_triggers');
	await pool.query('DELETE FROM posting_locks');
});

afterAll(async () => {
	await pool.end();
});

describe('proxied messages', () => {
	it('records a message and finds it back by guild and message id', async () => {
		await recordProxiedMessage(pool, 'g1', 'm1', 'c1', 'u1', 42);
		expect(await findProxiedMessage(pool, 'g1', 'm1')).toEqual({ discordUserId: 'u1', characterId: 42 });
	});

	it('finds nothing for an unknown message', async () => {
		expect(await findProxiedMessage(pool, 'g1', 'nope')).toBeNull();
	});

	it('a second record of the same message replaces the first', async () => {
		await recordProxiedMessage(pool, 'g1', 'm1', 'c1', 'u1', 42);
		await recordProxiedMessage(pool, 'g1', 'm1', 'c1', 'u2', 43);
		expect(await findProxiedMessage(pool, 'g1', 'm1')).toEqual({ discordUserId: 'u2', characterId: 43 });
	});
});

describe('triggers', () => {
	it('sets, reads and clears a trigger', async () => {
		expect(await getTrigger(pool, 'g1', 'u1')).toBeNull();
		await setTrigger(pool, 'g1', 'u1', 'k:');
		expect(await getTrigger(pool, 'g1', 'u1')).toBe('k:');
		await clearTrigger(pool, 'g1', 'u1');
		expect(await getTrigger(pool, 'g1', 'u1')).toBeNull();
	});

	it('setting a trigger again replaces the old one', async () => {
		await setTrigger(pool, 'g1', 'u1', 'k:');
		await setTrigger(pool, 'g1', 'u1', '[[');
		expect(await getTrigger(pool, 'g1', 'u1')).toBe('[[');
	});
});

describe('locks', () => {
	it('a channel-scoped lock reaches only its own channel', async () => {
		await setLock(pool, 'g1', 'u1', 'c1', 42);
		expect(await getLockForChannel(pool, 'g1', 'u1', 'c1')).toEqual({ channelId: 'c1', characterId: 42 });
		expect(await getLockForChannel(pool, 'g1', 'u1', 'c2')).toBeNull();
	});

	it('a server-wide lock reaches every channel', async () => {
		await setLock(pool, 'g1', 'u1', null, 42);
		expect(await getLockForChannel(pool, 'g1', 'u1', 'c1')).toEqual({ channelId: null, characterId: 42 });
		expect(await getLockForChannel(pool, 'g1', 'u1', 'c2')).toEqual({ channelId: null, characterId: 42 });
	});

	it('setting a lock again replaces the old one, channel-scoped or not', async () => {
		await setLock(pool, 'g1', 'u1', 'c1', 42);
		await setLock(pool, 'g1', 'u1', null, 43);
		expect(await getLockForChannel(pool, 'g1', 'u1', 'c1')).toEqual({ channelId: null, characterId: 43 });
	});

	it('clearing a lock leaves nothing to find', async () => {
		await setLock(pool, 'g1', 'u1', null, 42);
		await clearLock(pool, 'g1', 'u1');
		expect(await getLockForChannel(pool, 'g1', 'u1', 'c1')).toBeNull();
	});
});
