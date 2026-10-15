import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { discoverRestRoot } from '../../src/be/discover.js';
import { callBe, BeApiError } from '../../src/be/client.js';
import {
	adjustPool,
	takeWound,
	healWound,
	findSessionForDate,
	createSession,
	closeSession,
	SessionAlreadyExistsError,
} from '../../src/be/temporaryState.js';

const WP_PATH = '/Users/greghacke/owbn/_localwp';
const WP_CLI = '/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp';
const SITE = 'http://localhost:8910';
const SLUG = 'revenant-it-temporary-state';
const DISCORD_USER_ID = 'it-test-temporary-state-user';
const HST_DISCORD_USER_ID = 'it-test-temporary-state-hst';
const SETUP_SCRIPT = '/tmp/revenant-it-temporary-state-setup.php';
const TEARDOWN_SCRIPT = '/tmp/revenant-it-temporary-state-teardown.php';
const FIXTURE_FILE = '/tmp/revenant-it-temporary-state-fixture.json';
const ATTENDANCE_SCRIPT = '/tmp/revenant-it-temporary-state-attendance.php';

function wpEvalFile(scriptPath: string): void {
	execFileSync(WP_CLI, ['eval-file', scriptPath, '--path=.'], { cwd: WP_PATH });
}

interface Fixture {
	game_id: number;
	character_id: number;
	connection_id: number;
	secret: string;
	attendee_id: number;
	non_attendee_id: number;
}

/**
 * A real round trip against the local Beyond Elysium site for step 2's own routes - proves the bot's
 * signed calls actually interoperate with live BE 1.6.1.1, through the real `Bot_Auth` allowlist and
 * dispatch, not just against fixtures and mocks.
 */
describe("against the local Beyond Elysium site, step 2's temporary state", () => {
	let restRoot: string;
	let connection: { be_connection_id: number; rest_root: string; game_slug: string };
	let secret: Buffer;
	let characterId: number;
	let attendeeId: number;
	let nonAttendeeId: number;

	beforeAll(async () => {
		writeFileSync(
			SETUP_SCRIPT,
			`<?php
$slug = '${SLUG}';
if ( \\BeyondElysium\\Models\\Game::find_by_slug( $slug ) ) {
	\\BeyondElysium\\Models\\Game::delete_with_content( $slug );
}
$game_id = (int) \\BeyondElysium\\Models\\Game::create( [ 'slug' => $slug, 'name' => 'Revenant Temporary State Test' ] );

$connected = \\BeyondElysium\\Models\\Bot_Connection::connect( $game_id, 'it-guild', 'IT Guild', 1 );

foreach ( [ 'it-temp-state-player', 'it-temp-state-hst' ] as $login ) {
	$existing = get_user_by( 'login', $login );
	if ( $existing ) {
		wp_delete_user( $existing->ID );
	}
}
$player_id = \\wp_insert_user( [ 'user_login' => 'it-temp-state-player', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $player_id, 'player' );

$hst_id = \\wp_insert_user( [ 'user_login' => 'it-temp-state-hst', 'user_pass' => wp_generate_password(), 'role' => 'editor' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $hst_id, 'hst' );

$character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Fixture Vampire', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'wp_user_id' => $player_id,
] );
\\BeyondElysium\\Models\\Character::update_sheet_data( $character_id, [
	'vampire-resources' => [ 'Blood' => [ 'permanent' => 10, 'temporary' => 10 ] ],
] );

$link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${DISCORD_USER_ID}', 'it-test-player-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $link['link_id'] ), $player_id, [ $character_id ], true );

$hst_link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${HST_DISCORD_USER_ID}', 'it-test-hst-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $hst_link['link_id'] ), $hst_id, [], true );

$attendee_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Fixture Attendee', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
] );
\\BeyondElysium\\Models\\Character::update_sheet_data( $attendee_id, [
	'vampire-resources' => [ 'Blood' => [ 'permanent' => 10, 'temporary' => 10 ] ],
] );
$non_attendee_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Fixture Non-Attendee', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
] );
\\BeyondElysium\\Models\\Character::update_sheet_data( $non_attendee_id, [
	'vampire-resources' => [ 'Blood' => [ 'permanent' => 10, 'temporary' => 10 ] ],
] );

file_put_contents( '${FIXTURE_FILE}', wp_json_encode( [
	'game_id' => $game_id,
	'character_id' => $character_id,
	'connection_id' => $connected['id'],
	'secret' => $connected['secret'],
	'attendee_id' => $attendee_id,
	'non_attendee_id' => $non_attendee_id,
] ) );
`
		);
		wpEvalFile(SETUP_SCRIPT);
		const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
		characterId = fixture.character_id;
		attendeeId = fixture.attendee_id;
		nonAttendeeId = fixture.non_attendee_id;
		restRoot = await discoverRestRoot(SITE, { allowInsecureLocalhost: true });
		connection = { be_connection_id: fixture.connection_id, rest_root: restRoot, game_slug: SLUG };
		secret = Buffer.from(fixture.secret, 'base64url');
	});

	afterAll(() => {
		writeFileSync(
			TEARDOWN_SCRIPT,
			`<?php
\\BeyondElysium\\Models\\Game::delete_with_content( '${SLUG}' );
foreach ( [ 'it-temp-state-player', 'it-temp-state-hst' ] as $login ) {
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

	it('spends and regains a real pool, clamped at the floor', async () => {
		const spent = await adjustPool(connection, secret, DISCORD_USER_ID, characterId, 'vampire-resources', 'Blood', -3, 'it test spend');
		expect(spent).toEqual({ permanent: 10, temporary: 7 });

		const regained = await adjustPool(connection, secret, DISCORD_USER_ID, characterId, 'vampire-resources', 'Blood', 2, 'it test regain');
		expect(regained).toEqual({ permanent: 10, temporary: 9 });

		const clamped = await adjustPool(connection, secret, DISCORD_USER_ID, characterId, 'vampire-resources', 'Blood', -20, 'it test overspend');
		expect(clamped).toEqual({ permanent: 10, temporary: 0 });
	});

	it('wounds and heals with armor folded into the reason', async () => {
		const wounded = await takeWound(connection, secret, DISCORD_USER_ID, characterId, 'lethal', 3, '2 to armor. Shot in the alley');
		expect(wounded).toEqual({ bashing: 0, lethal: 3, aggravated: 0 });

		const healed = await healWound(connection, secret, DISCORD_USER_ID, characterId, 'lethal', 1);
		expect(healed).toEqual({ bashing: 0, lethal: 2, aggravated: 0 });
	});

	it('refuses a wound signed by a Discord user not linked to this character', async () => {
		await expect(takeWound(connection, secret, 'it-unlinked-user', characterId, 'bashing', 1, '')).rejects.toMatchObject({
			kind: 'user_not_linked',
		});
	});

	it('opens tonight finding none existing, then refuses a second create for the same date', async () => {
		const today = new Date().toISOString().slice(0, 10);

		const existing = await findSessionForDate(connection, secret, HST_DISCORD_USER_ID, today);
		expect(existing).toBeNull();

		const created = await createSession(connection, secret, HST_DISCORD_USER_ID, today);
		expect(created.game_date).toBe(today);

		await expect(createSession(connection, secret, HST_DISCORD_USER_ID, today)).rejects.toBeInstanceOf(SessionAlreadyExistsError);

		const foundAfter = await findSessionForDate(connection, secret, HST_DISCORD_USER_ID, today);
		expect(foundAfter?.id).toBe(created.id);
	});

	it('refuses a session close signed by a plain player', async () => {
		const today = new Date().toISOString().slice(0, 10);
		const session = await findSessionForDate(connection, secret, HST_DISCORD_USER_ID, today);
		expect(session).not.toBeNull();

		await expect(closeSession(connection, secret, DISCORD_USER_ID, session!.id)).rejects.toBeInstanceOf(BeApiError);
	});

	it('closing a session resets a real attendee and leaves a non-attendee untouched', async () => {
		const today = new Date().toISOString().slice(0, 10);
		const session = await findSessionForDate(connection, secret, HST_DISCORD_USER_ID, today);
		expect(session).not.toBeNull();

		// Attendance isn't one of step 2's own bot-reachable routes (BE's own /checkin is step 5's
		// concern) - recorded directly, the same way the test's own setup is, not through the bot.
		writeFileSync(
			ATTENDANCE_SCRIPT,
			`<?php
\\BeyondElysium\\Models\\Attendance::record( ${session!.id}, \\BeyondElysium\\Models\\Game::find_by_slug( '${SLUG}' )->id, [ 'character_id' => ${attendeeId} ] );
`
		);
		wpEvalFile(ATTENDANCE_SCRIPT);
		rmSync(ATTENDANCE_SCRIPT, { force: true });

		await adjustPool(connection, secret, HST_DISCORD_USER_ID, attendeeId, 'vampire-resources', 'Blood', -4, 'it test attendee spend');
		await adjustPool(connection, secret, HST_DISCORD_USER_ID, nonAttendeeId, 'vampire-resources', 'Blood', -4, 'it test non-attendee spend');

		await closeSession(connection, secret, HST_DISCORD_USER_ID, session!.id);

		const attendeeCharacter = await callBe<{ sheet_data: Record<string, unknown> }>(restRoot, {
			method: 'GET',
			route: `/be/v1/${SLUG}/characters/${attendeeId}`,
			signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: HST_DISCORD_USER_ID },
		});
		const attendeePool = (attendeeCharacter.sheet_data['vampire-resources'] as Record<string, { temporary: number }>).Blood!;
		expect(attendeePool.temporary).toBe(10);

		const nonAttendeeCharacter = await callBe<{ sheet_data: Record<string, unknown> }>(restRoot, {
			method: 'GET',
			route: `/be/v1/${SLUG}/characters/${nonAttendeeId}`,
			signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: HST_DISCORD_USER_ID },
		});
		const nonAttendeePool = (nonAttendeeCharacter.sheet_data['vampire-resources'] as Record<string, { temporary: number }>).Blood!;
		expect(nonAttendeePool.temporary).toBe(6);
	});
});
