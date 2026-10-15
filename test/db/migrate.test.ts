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
			'connections',
			'dice_log',
			'guild_settings',
			'schema_migrations',
			'user_prefs',
		]);
	});

	const MIGRATION_FILES = ['001_initial.sql', '002_night.sql', '003_challenges.sql'];

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
