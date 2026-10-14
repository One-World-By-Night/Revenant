import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { discoverRestRoot } from '../../src/be/discover.js';
import { callBe, BeApiError } from '../../src/be/client.js';

const WP_PATH = '/Users/greghacke/owbn/_localwp';
const WP_CLI = '/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp';
const SITE = 'http://localhost:8910';
const SLUG = 'revenant-it-test';
const SETUP_SCRIPT = '/tmp/revenant-it-setup.php';
const TEARDOWN_SCRIPT = '/tmp/revenant-it-teardown.php';
const FIXTURE_FILE = '/tmp/revenant-it-fixture.json';

function wpEvalFile(scriptPath: string): void {
	execFileSync(WP_CLI, ['eval-file', scriptPath, '--path=.'], { cwd: WP_PATH });
}

interface ConnectResponse {
	connection_id: number;
	secret: string;
	rest_root: string;
	game: { slug: string; name: string };
	be_version: string;
}

interface StatusResponse {
	be_version: string;
	game: { slug: string; name: string } | null;
	connection: { id: number; guild_id: string; guild_name: string };
}

/**
 * A real round trip against the local Beyond Elysium site: proves the bot's own signing, discovery
 * and client code actually interoperate with a live BE 1.6.0, not just with fixtures and mocks. Needs
 * the local WordPress site running at http://localhost:8910.
 */
describe('against the local Beyond Elysium site', () => {
	let gameId: number;
	let code: string;
	let restRoot: string;
	let connectionId: number;
	let secret: Buffer;

	beforeAll(async () => {
		writeFileSync(
			SETUP_SCRIPT,
			`<?php
$slug = '${SLUG}';
if ( \\BeyondElysium\\Models\\Game::find_by_slug( $slug ) ) {
	\\BeyondElysium\\Models\\Game::delete_with_content( $slug );
}
$game_id = (int) \\BeyondElysium\\Models\\Game::create( [ 'slug' => $slug, 'name' => 'Revenant Integration Test' ] );
wp_set_current_user( 1 );
$code = \\BeyondElysium\\Models\\Bot_Connect_Code::generate( $game_id, 1 );
file_put_contents( '${FIXTURE_FILE}', wp_json_encode( [ 'game_id' => $game_id, 'code' => $code ] ) );
`
		);
		wpEvalFile(SETUP_SCRIPT);
		const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { game_id: number; code: string };
		gameId = fixture.game_id;
		code = fixture.code;
		restRoot = await discoverRestRoot(SITE, { allowInsecureLocalhost: true });
	});

	afterAll(() => {
		writeFileSync(TEARDOWN_SCRIPT, `<?php\n\\BeyondElysium\\Models\\Game::delete_with_content( '${SLUG}' );\n`);
		wpEvalFile(TEARDOWN_SCRIPT);
		rmSync(SETUP_SCRIPT, { force: true });
		rmSync(TEARDOWN_SCRIPT, { force: true });
		rmSync(FIXTURE_FILE, { force: true });
	});

	it('discovers a real REST root', () => {
		expect(restRoot).toContain('wp-json');
		expect(gameId).toBeGreaterThan(0);
	});

	it('refuses an invalid connect code', async () => {
		await expect(
			callBe(restRoot, { method: 'POST', route: '/be/v1/bot/connect', body: { code: 'WRONGCODE12', guild_id: 'x', guild_name: 'x' } })
		).rejects.toMatchObject({ beCode: 'invalid_code' });
	});

	it('connects with the real connect code and gets back a usable secret', async () => {
		const result = await callBe<ConnectResponse>(restRoot, {
			method: 'POST',
			route: '/be/v1/bot/connect',
			body: { code, guild_id: 'it-test-guild', guild_name: 'IT Test Guild' },
		});
		expect(result.game.slug).toBe(SLUG);
		expect(result.secret.length).toBeGreaterThan(0);
		connectionId = result.connection_id;
		secret = Buffer.from(result.secret, 'base64url');
	});

	it('makes a signed service call with the real secret', async () => {
		const status = await callBe<StatusResponse>(restRoot, {
			method: 'GET',
			route: `/be/v1/${SLUG}/bot/status`,
			signedAs: { connectionId: String(connectionId), secret },
		});
		expect(status.game?.slug).toBe(SLUG);
		expect(status.connection.guild_id).toBe('it-test-guild');
	});

	it('rejects a tampered signature', async () => {
		await expect(
			callBe(restRoot, {
				method: 'GET',
				route: `/be/v1/${SLUG}/bot/status`,
				signedAs: { connectionId: String(connectionId), secret: Buffer.alloc(32, 7) },
			})
		).rejects.toMatchObject({ kind: 'auth_failed' });
	});

	it('refuses reconnecting with the same code once it has been used', async () => {
		await expect(
			callBe(restRoot, { method: 'POST', route: '/be/v1/bot/connect', body: { code, guild_id: 'y', guild_name: 'y' } })
		).rejects.toBeInstanceOf(BeApiError);
	});

	it('disconnects, after which the same secret no longer signs successfully', async () => {
		await callBe(restRoot, {
			method: 'POST',
			route: `/be/v1/${SLUG}/bot/disconnect`,
			signedAs: { connectionId: String(connectionId), secret },
		});

		await expect(
			callBe(restRoot, { method: 'GET', route: `/be/v1/${SLUG}/bot/status`, signedAs: { connectionId: String(connectionId), secret } })
		).rejects.toBeInstanceOf(BeApiError);
	});
});
