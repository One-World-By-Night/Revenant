import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { discoverRestRoot } from '../../src/be/discover.js';
import { fetchPostingProfile } from '../../src/be/postingProfile.js';
import { BeApiError } from '../../src/be/client.js';

const WP_PATH = '/Users/greghacke/owbn/_localwp';
const WP_CLI = '/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp';
const SITE = 'http://localhost:8910';
const SLUG = 'revenant-it-posting-profile';
const PLAYER_DISCORD_ID = 'it-test-posting-player';
const STORYTELLER_DISCORD_ID = 'it-test-posting-storyteller';
const SETUP_SCRIPT = '/tmp/revenant-it-posting-profile-setup.php';
const TEARDOWN_SCRIPT = '/tmp/revenant-it-posting-profile-teardown.php';
const FIXTURE_FILE = '/tmp/revenant-it-posting-profile-fixture.json';

function wpEvalFile(scriptPath: string): void {
	execFileSync(WP_CLI, ['eval-file', scriptPath, '--path=.'], { cwd: WP_PATH });
}

function wpEval(code: string): string {
	return execFileSync(WP_CLI, ['eval', code, '--path=.'], { cwd: WP_PATH }).toString('utf8');
}

interface Fixture {
	connection_id: number;
	secret: string;
	player_character_id: number;
	npc_character_id: number;
	other_player_character_id: number;
}

describe('against the local Beyond Elysium site, a posting profile', () => {
	let connection: { be_connection_id: number; rest_root: string; game_slug: string };
	let secret: Buffer;
	let playerCharacterId: number;
	let npcCharacterId: number;
	let otherPlayerCharacterId: number;

	beforeAll(async () => {
		writeFileSync(
			SETUP_SCRIPT,
			`<?php
$slug = '${SLUG}';
if ( \\BeyondElysium\\Models\\Game::find_by_slug( $slug ) ) {
	\\BeyondElysium\\Models\\Game::delete_with_content( $slug );
}
$game_id = (int) \\BeyondElysium\\Models\\Game::create( [ 'slug' => $slug, 'name' => 'Revenant Posting Profile Test' ] );

$connected = \\BeyondElysium\\Models\\Bot_Connection::connect( $game_id, 'it-guild', 'IT Guild', 1 );

foreach ( [ 'it-posting-player', 'it-posting-storyteller', 'it-posting-other' ] as $login ) {
	$existing = get_user_by( 'login', $login );
	if ( $existing ) {
		wp_delete_user( $existing->ID );
	}
}
$player_user_id = \\wp_insert_user( [ 'user_login' => 'it-posting-player', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
$storyteller_user_id = \\wp_insert_user( [ 'user_login' => 'it-posting-storyteller', 'user_pass' => wp_generate_password(), 'role' => 'editor' ] );
$other_user_id = \\wp_insert_user( [ 'user_login' => 'it-posting-other', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $player_user_id, 'player' );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $storyteller_user_id, 'hst' );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $other_user_id, 'player' );

$player_character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Posting Player', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'wp_user_id' => $player_user_id,
] );
$npc_character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Posting NPC', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'is_npc' => 1,
] );
$other_player_character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Posting Other', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'wp_user_id' => $other_user_id,
] );

$link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${PLAYER_DISCORD_ID}', 'it-posting-player-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $link['link_id'] ), $player_user_id, [ $player_character_id ], true );
$st_link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${STORYTELLER_DISCORD_ID}', 'it-posting-storyteller-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $st_link['link_id'] ), $storyteller_user_id, [], true );

file_put_contents( '${FIXTURE_FILE}', wp_json_encode( [
	'connection_id' => $connected['id'],
	'secret' => $connected['secret'],
	'player_character_id' => $player_character_id,
	'npc_character_id' => $npc_character_id,
	'other_player_character_id' => $other_player_character_id,
] ) );
`
		);
		wpEvalFile(SETUP_SCRIPT);
		const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
		playerCharacterId = fixture.player_character_id;
		npcCharacterId = fixture.npc_character_id;
		otherPlayerCharacterId = fixture.other_player_character_id;
		const restRoot = await discoverRestRoot(SITE, { allowInsecureLocalhost: true });
		connection = { be_connection_id: fixture.connection_id, rest_root: restRoot, game_slug: SLUG };
		secret = Buffer.from(fixture.secret, 'base64url');
	});

	afterAll(() => {
		writeFileSync(
			TEARDOWN_SCRIPT,
			`<?php
\\BeyondElysium\\Models\\Game::delete_with_content( '${SLUG}' );
foreach ( [ 'it-posting-player', 'it-posting-storyteller', 'it-posting-other' ] as $login ) {
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

	it("falls back to the real name with no public profile until the chronicle sets one", async () => {
		const profile = await fetchPostingProfile(connection, secret, PLAYER_DISCORD_ID, playerCharacterId);
		expect(profile).toEqual({
			id: playerCharacterId,
			display_name: 'IT Posting Player',
			image_url: null,
			is_npc: false,
			profile_public: false,
		});
	});

	it('prefers the public name and reports public once the audience is set to everyone', async () => {
		wpEval(
			`echo \\BeyondElysium\\Models\\Character::update_header( ${playerCharacterId}, [ 'public_name' => 'The Masked One', 'profile_audience' => 'everyone' ] ) ? '1' : '0';`
		);

		const profile = await fetchPostingProfile(connection, secret, PLAYER_DISCORD_ID, playerCharacterId);
		expect(profile.display_name).toBe('The Masked One');
		expect(profile.profile_public).toBe(true);
	});

	it('lets a Storyteller fetch an NPC profile they do not own', async () => {
		const profile = await fetchPostingProfile(connection, secret, STORYTELLER_DISCORD_ID, npcCharacterId);
		expect(profile.is_npc).toBe(true);
		expect(profile.display_name).toBe('IT Posting NPC');
	});

	it("refuses a player who neither owns nor manages the character", async () => {
		await expect(fetchPostingProfile(connection, secret, PLAYER_DISCORD_ID, otherPlayerCharacterId)).rejects.toThrow(BeApiError);
	});
});
