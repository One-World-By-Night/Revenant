import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { discoverRestRoot } from '../../src/be/discover.js';
import { fetchNotices, ackNotices } from '../../src/be/notices.js';
import { fetchApprovedLinksForRouting } from '../../src/be/rooms.js';

const WP_PATH = '/Users/greghacke/owbn/_localwp';
const WP_CLI = '/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp';
const SITE = 'http://localhost:8910';
const SLUG = 'revenant-it-notices';
const PLAYER_DISCORD_ID = 'it-test-notices-player';
const SETUP_SCRIPT = '/tmp/revenant-it-notices-setup.php';
const TEARDOWN_SCRIPT = '/tmp/revenant-it-notices-teardown.php';
const FIXTURE_FILE = '/tmp/revenant-it-notices-fixture.json';

function wpEvalFile(scriptPath: string): void {
	execFileSync(WP_CLI, ['eval-file', scriptPath, '--path=.'], { cwd: WP_PATH });
}

interface Fixture {
	connection_id: number;
	secret: string;
	player_wp_user_id: number;
	character_id: number;
}

describe("against the local Beyond Elysium site, the bot's own notice feed", () => {
	let connection: { be_connection_id: number; rest_root: string; game_slug: string };
	let secret: Buffer;
	let playerWpUserId: number;
	let characterId: number;

	beforeAll(async () => {
		writeFileSync(
			SETUP_SCRIPT,
			`<?php
$slug = '${SLUG}';
if ( \\BeyondElysium\\Models\\Game::find_by_slug( $slug ) ) {
	\\BeyondElysium\\Models\\Game::delete_with_content( $slug );
}
$game_id = (int) \\BeyondElysium\\Models\\Game::create( [ 'slug' => $slug, 'name' => 'Revenant Notices Test' ] );

$connected = \\BeyondElysium\\Models\\Bot_Connection::connect( $game_id, 'it-guild', 'IT Guild', 1 );

$existing = get_user_by( 'login', 'it-notices-player' );
if ( $existing ) {
	wp_delete_user( $existing->ID );
}
$player_id = \\wp_insert_user( [ 'user_login' => 'it-notices-player', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $player_id, 'player' );

$character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Notices Character', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'wp_user_id' => $player_id,
] );
\\BeyondElysium\\Models\\Character::update_xp( $character_id, 20, 20 );

$link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${PLAYER_DISCORD_ID}', 'it-notices-player-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $link['link_id'] ), $player_id, [ $character_id ], true );

file_put_contents( '${FIXTURE_FILE}', wp_json_encode( [
	'connection_id' => $connected['id'],
	'secret' => $connected['secret'],
	'player_wp_user_id' => $player_id,
	'character_id' => $character_id,
] ) );
`
		);
		wpEvalFile(SETUP_SCRIPT);
		const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
		playerWpUserId = fixture.player_wp_user_id;
		characterId = fixture.character_id;
		const restRoot = await discoverRestRoot(SITE, { allowInsecureLocalhost: true });
		connection = { be_connection_id: fixture.connection_id, rest_root: restRoot, game_slug: SLUG };
		secret = Buffer.from(fixture.secret, 'base64url');
	});

	afterAll(() => {
		writeFileSync(
			TEARDOWN_SCRIPT,
			`<?php
\\BeyondElysium\\Models\\Game::delete_with_content( '${SLUG}' );
$existing = get_user_by( 'login', 'it-notices-player' );
if ( $existing ) {
	wp_delete_user( $existing->ID );
}
`
		);
		wpEvalFile(TEARDOWN_SCRIPT);
		rmSync(SETUP_SCRIPT, { force: true });
		rmSync(TEARDOWN_SCRIPT, { force: true });
		rmSync(FIXTURE_FILE, { force: true });
	});

	it('sees a real change-decided notice after approving a real pending change, then acks it', async () => {
		const changeScript = '/tmp/revenant-it-notices-change.php';
		const changeFixture = '/tmp/revenant-it-notices-change-fixture.json';
		writeFileSync(
			changeScript,
			`<?php
$change_id = (int) \\BeyondElysium\\Models\\Change::create( [
	'character_id' => ${characterId}, 'change_type' => 'add_trait', 'category' => 'trait',
	'change_data' => [ 'block_slug' => 'vampire-abilities', 'trait' => [ 'name' => 'Occult', 'count' => 3 ] ],
	'xp_cost' => 5, 'status' => 'pending', 'submitted_by' => ${playerWpUserId},
] );
file_put_contents( '${changeFixture}', wp_json_encode( [ 'change_id' => $change_id ] ) );
`
		);
		wpEvalFile(changeScript);
		const { change_id: changeId } = JSON.parse(readFileSync(changeFixture, 'utf8')) as { change_id: number };
		rmSync(changeScript, { force: true });
		rmSync(changeFixture, { force: true });

		// The real REST route, dispatched as a real signed-in Storyteller - not Change_Engine::approve()
		// directly, since Notifications::enqueue() (and now Bot_Notice::add()) live in Changes_Controller's
		// own call sites, not in the engine itself, and that route isn't on the bot's own signed allowlist.
		const approveScript = '/tmp/revenant-it-notices-approve.php';
		writeFileSync(
			approveScript,
			`<?php
wp_set_current_user( 1 );
do_action( 'rest_api_init' );
$request = new WP_REST_Request( 'PUT', '/be/v1/${SLUG}/changes/${changeId}' );
$request->set_header( 'Content-Type', 'application/json' );
$request->set_body( wp_json_encode( [ 'status' => 'approved' ] ) );
$response = rest_get_server()->dispatch( $request );
echo 'status=' . $response->get_status() . "\\n";
`
		);
		const approveOutput = execFileSync(WP_CLI, ['eval-file', approveScript, '--path=.'], { cwd: WP_PATH }).toString('utf8');
		rmSync(approveScript, { force: true });
		expect(approveOutput).toContain('status=200');

		const notices = await fetchNotices(connection, secret);
		const decided = notices.filter((n) => n.kind === 'change_decided');
		expect(decided.length).toBeGreaterThanOrEqual(1);
		expect(decided[0]?.wp_user_id).toBe(playerWpUserId);

		await ackNotices(
			connection,
			secret,
			notices.map((n) => n.id)
		);
		const afterAck = await fetchNotices(connection, secret);
		expect(afterAck).toEqual([]);
	});

	it('lists the real approved link for routing', async () => {
		const links = await fetchApprovedLinksForRouting(connection, secret);
		const mine = links.find((l) => l.wp_user_id === playerWpUserId);
		expect(mine).toBeDefined();
		expect(mine?.discord_user_id).toBe(PLAYER_DISCORD_ID);
		expect(mine?.room_channel_id).toBeNull();
	});
});
