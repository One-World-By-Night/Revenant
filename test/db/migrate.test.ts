import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';

const { Pool } = pg;

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:devpassword@localhost:55432/berevenant_test';
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

const pool = new Pool({ connectionString: DATABASE_URL });

beforeEach(async () => {
	await pool.query('DROP SCHEMA public CASCADE');
	await pool.query('CREATE SCHEMA public');
});

afterAll(async () => {
	await pool.end();
});

async function tableNames(): Promise<string[]> {
	const { rows } = await pool.query<{ table_name: string }>(
		"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
	);
	return rows.map((row) => row.table_name);
}

describe('runMigrations', () => {
	it('creates every table from every migration', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);
		expect(await tableNames()).toEqual([
			'challenge_costs',
			'challenges',
			'channel_webhooks',
			'connections',
			'delivered_notices',
			'dice_log',
			'guild_settings',
			'posting_locks',
			'posting_triggers',
			'proxied_messages',
			'schema_migrations',
			'user_prefs',
		]);
	});

	const MIGRATION_FILES = [
		'001_initial.sql',
		'002_night.sql',
		'003_challenges.sql',
		'004_challenge_settings.sql',
		'005_posting.sql',
		'006_rooms.sql',
		'007_delivered_notices.sql',
	];

	it('records every applied migration', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);
		const { rows } = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
		expect(rows).toEqual(MIGRATION_FILES.map((filename) => ({ filename })));
	});

	it('reports which migrations were newly applied', async () => {
		const applied = await runMigrations(pool, MIGRATIONS_DIR);
		expect(applied).toEqual(MIGRATION_FILES);
	});

	it('runs twice without harm: the second run applies nothing and changes nothing', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);
		const before = await tableNames();

		const secondRun = await runMigrations(pool, MIGRATIONS_DIR);

		expect(secondRun).toEqual([]);
		expect(await tableNames()).toEqual(before);
		const { rows } = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
		expect(rows).toEqual(MIGRATION_FILES.map((filename) => ({ filename })));
	});

	it('adds trait_cap and challenge_timeout_minutes to guild_settings', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);
		await pool.query("INSERT INTO guild_settings (guild_id, trait_cap) VALUES ('g2', 30)");
		const { rows } = await pool.query('SELECT trait_cap, challenge_timeout_minutes FROM guild_settings WHERE guild_id = $1', ['g2']);
		expect(rows).toEqual([{ trait_cap: 30, challenge_timeout_minutes: 60 }]);
	});

	it('challenge_costs references a real challenge row', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);
		await pool.query(
			"INSERT INTO challenges (guild_id, channel_id, kind, status, challenger_discord_id, conditions, state) VALUES ('g1', 'c1', 'simple_test', 'throwing', 'u1', 'a quick test', '{}')"
		);
		const { rows: challengeRows } = await pool.query('SELECT id FROM challenges');
		await pool.query('INSERT INTO challenge_costs (challenge_id, kind, payload) VALUES ($1, $2, $3)', [
			challengeRows[0]!.id,
			'wound',
			'{}',
		]);
		const { rows } = await pool.query('SELECT challenge_id FROM challenge_costs');
		expect(rows).toEqual([{ challenge_id: challengeRows[0]!.id }]);
	});

	it('adds open_session_id to guild_settings', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);
		await pool.query("INSERT INTO guild_settings (guild_id, open_session_id) VALUES ('g1', 42)");
		const { rows } = await pool.query('SELECT open_session_id FROM guild_settings WHERE guild_id = $1', ['g1']);
		expect(rows).toEqual([{ open_session_id: 42 }]);
	});

	it('adds role sync columns to guild_settings, off by default', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);
		await pool.query("INSERT INTO guild_settings (guild_id) VALUES ('g3')");
		const { rows } = await pool.query(
			'SELECT role_sync_enabled, player_role_id, narrator_role_id, storyteller_role_id FROM guild_settings WHERE guild_id = $1',
			['g3']
		);
		expect(rows).toEqual([{ role_sync_enabled: false, player_role_id: null, narrator_role_id: null, storyteller_role_id: null }]);

		await pool.query(
			"UPDATE guild_settings SET role_sync_enabled = true, player_role_id = 'p1', narrator_role_id = 'n1', storyteller_role_id = 's1' WHERE guild_id = 'g3'"
		);
		const { rows: updated } = await pool.query(
			'SELECT role_sync_enabled, player_role_id, narrator_role_id, storyteller_role_id FROM guild_settings WHERE guild_id = $1',
			['g3']
		);
		expect(updated).toEqual([{ role_sync_enabled: true, player_role_id: 'p1', narrator_role_id: 'n1', storyteller_role_id: 's1' }]);
	});

	it('stores a channel webhook, a trigger, a lock, and a proxied message', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);

		await pool.query(
			"INSERT INTO channel_webhooks (guild_id, channel_id, webhook_id, webhook_token_enc) VALUES ('g1', 'c1', 'w1', '\\x00')"
		);
		await pool.query("INSERT INTO posting_triggers (guild_id, discord_user_id, trigger) VALUES ('g1', 'u1', 'k:')");
		await pool.query("INSERT INTO posting_locks (guild_id, discord_user_id, channel_id, character_id) VALUES ('g1', 'u1', 'c1', 42)");
		await pool.query("INSERT INTO posting_locks (guild_id, discord_user_id, channel_id, character_id) VALUES ('g1', 'u2', NULL, 43)");
		await pool.query(
			"INSERT INTO proxied_messages (guild_id, message_id, channel_id, discord_user_id, character_id) VALUES ('g1', 'm1', 'c1', 'u1', 42)"
		);

		const { rows: locks } = await pool.query('SELECT discord_user_id, channel_id, character_id FROM posting_locks ORDER BY discord_user_id');
		expect(locks).toEqual([
			{ discord_user_id: 'u1', channel_id: 'c1', character_id: 42 },
			{ discord_user_id: 'u2', channel_id: null, character_id: 43 },
		]);
		const { rows: proxied } = await pool.query('SELECT character_id FROM proxied_messages WHERE message_id = $1', ['m1']);
		expect(proxied).toEqual([{ character_id: 42 }]);
	});

	it('can insert into every created table', async () => {
		await runMigrations(pool, MIGRATIONS_DIR);

		await pool.query(
			`INSERT INTO connections (guild_id, site_url, rest_root, be_connection_id, secret_enc, game_slug, game_name, connected_by)
			 VALUES ('g1', 'https://example.test', 'https://example.test/wp-json/', 1, '\\x00', 'be-demo', 'Demo', 'u1')`
		);
		await pool.query(
			"INSERT INTO user_prefs (guild_id, discord_user_id) VALUES ('g1', 'u1')"
		);
		await pool.query("INSERT INTO guild_settings (guild_id) VALUES ('g1')");
		await pool.query(
			"INSERT INTO dice_log (guild_id, channel_id, discord_user_id, expression, result) VALUES ('g1', 'c1', 'u1', '2d6', '{}')"
		);

		const { rows: connectionRows } = await pool.query('SELECT guild_id FROM connections');
		expect(connectionRows).toEqual([{ guild_id: 'g1' }]);
	});
});
