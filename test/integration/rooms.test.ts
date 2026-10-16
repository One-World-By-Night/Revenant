import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { discoverRestRoot } from '../../src/be/discover.js';
import { fetchApprovedLinks, setRoom, fetchCapabilitiesFor, roleForCapabilities } from '../../src/be/rooms.js';
import { BeApiError } from '../../src/be/client.js';

const WP_PATH = '/Users/greghacke/owbn/_localwp';
const WP_CLI = '/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp';
const SITE = 'http://localhost:8910';
const SLUG = 'revenant-it-rooms';
const PLAYER_DISCORD_ID = 'it-test-rooms-player';
const HST_DISCORD_ID = 'it-test-rooms-hst';
const SETUP_SCRIPT = '/tmp/revenant-it-rooms-setup.php';
const TEARDOWN_SCRIPT = '/tmp/revenant-it-rooms-teardown.php';
const FIXTURE_FILE = '/tmp/revenant-it-rooms-fixture.json';

function wpEvalFile(scriptPath: string): void {
	execFileSync(WP_CLI, ['eval-file', scriptPath, '--path=.'], { cwd: WP_PATH });
}

interface Fixture {
	connection_id: number;
	secret: string;
	player_link_id: number;
	hst_link_id: number;
}

describe("against the local Beyond Elysium site, a linked player's room", () => {
	let connection: { be_connection_id: number; rest_root: string; game_slug: string };
	let secret: Buffer;
	let playerLinkId: number;

	beforeAll(async () => {
		writeFileSync(
			SETUP_SCRIPT,
			`<?php
$slug = '${SLUG}';
if ( \\BeyondElysium\\Models\\Game::find_by_slug( $slug ) ) {
	\\BeyondElysium\\Models\\Game::delete_with_content( $slug );
}
$game_id = (int) \\BeyondElysium\\Models\\Game::create( [ 'slug' => $slug, 'name' => 'Revenant Rooms Test' ] );

$connected = \\BeyondElysium\\Models\\Bot_Connection::connect( $game_id, 'it-guild', 'IT Guild', 1 );

foreach ( [ 'it-rooms-player', 'it-rooms-hst' ] as $login ) {
	$existing = get_user_by( 'login', $login );
	if ( $existing ) {
		wp_delete_user( $existing->ID );
	}
}
$player_id = \\wp_insert_user( [ 'user_login' => 'it-rooms-player', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $player_id, 'player' );
$hst_id = \\wp_insert_user( [ 'user_login' => 'it-rooms-hst', 'user_pass' => wp_generate_password(), 'role' => 'editor' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $hst_id, 'hst' );

$player_link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${PLAYER_DISCORD_ID}', 'it-rooms-player-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $player_link['link_id'] ), $player_id, [], true );
$hst_link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${HST_DISCORD_ID}', 'it-rooms-hst-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $hst_link['link_id'] ), $hst_id, [], true );

file_put_contents( '${FIXTURE_FILE}', wp_json_encode( [
	'connection_id' => $connected['id'],
	'secret' => $connected['secret'],
	'player_link_id' => $player_link['link_id'],
	'hst_link_id' => $hst_link['link_id'],
] ) );
`
		);
		wpEvalFile(SETUP_SCRIPT);
		const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
		playerLinkId = fixture.player_link_id;
		const restRoot = await discoverRestRoot(SITE, { allowInsecureLocalhost: true });
		connection = { be_connection_id: fixture.connection_id, rest_root: restRoot, game_slug: SLUG };
		secret = Buffer.from(fixture.secret, 'base64url');
	});

	afterAll(() => {
		writeFileSync(
			TEARDOWN_SCRIPT,
			`<?php
\\BeyondElysium\\Models\\Game::delete_with_content( '${SLUG}' );
foreach ( [ 'it-rooms-player', 'it-rooms-hst' ] as $login ) {
	$existing = get_user_by( 'login', $login );
	if ( $existing ) {
		wp_delete_user( $existing->ID );
	}
}
`
		);
		wpEvalFile(TEARDOWN_SCRIPT);
		rmSync(SETUP_SCRIPT, { force: true });
		rmSync(TEARDOWN_SCRIPT, { force: true });
		rmSync(FIXTURE_FILE, { force: true });
	});

	it('lists both approved links with no room set yet', async () => {
		const links = await fetchApprovedLinks(connection, secret, HST_DISCORD_ID);
		const player = links.find((link) => link.discord_user_id === PLAYER_DISCORD_ID);
		expect(player).toBeDefined();
		expect(player?.room_channel_id).toBeNull();
	});

	it('sets a room, then clears it', async () => {
		await setRoom(connection, secret, HST_DISCORD_ID, playerLinkId, '123456789');
		let links = await fetchApprovedLinks(connection, secret, HST_DISCORD_ID);
		let player = links.find((link) => link.discord_user_id === PLAYER_DISCORD_ID);
		expect(player?.room_channel_id).toBe('123456789');

		await setRoom(connection, secret, HST_DISCORD_ID, playerLinkId, null);
		links = await fetchApprovedLinks(connection, secret, HST_DISCORD_ID);
		player = links.find((link) => link.discord_user_id === PLAYER_DISCORD_ID);
		expect(player?.room_channel_id).toBeNull();
	});

	it('refuses a plain player setting a room', async () => {
		await expect(setRoom(connection, secret, PLAYER_DISCORD_ID, playerLinkId, '1')).rejects.toThrow(BeApiError);
	});

	it("resolves each real link's own role from their real capabilities", async () => {
		const playerCapabilities = await fetchCapabilitiesFor(connection, secret, PLAYER_DISCORD_ID);
		expect(roleForCapabilities(playerCapabilities)).toBe('player');

		const hstCapabilities = await fetchCapabilitiesFor(connection, secret, HST_DISCORD_ID);
		expect(roleForCapabilities(hstCapabilities)).toBe('storyteller');
	});
});
