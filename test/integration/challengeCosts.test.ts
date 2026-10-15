import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { discoverRestRoot } from '../../src/be/discover.js';
import { fetchCharacterRaw, readNightLosses, readWounds } from '../../src/be/temporaryState.js';
import { applyCosts, reverseCost, type CostTarget } from '../../src/challenges/costs.js';
import type { Outcome } from '../../src/challenges/engine.js';

const WP_PATH = '/Users/greghacke/owbn/_localwp';
const WP_CLI = '/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp';
const SITE = 'http://localhost:8910';
const SLUG = 'revenant-it-challenge-costs';
const CHALLENGER_DISCORD_ID = 'it-test-challenge-challenger';
const DEFENDER_DISCORD_ID = 'it-test-challenge-defender';
const SETUP_SCRIPT = '/tmp/revenant-it-challenge-costs-setup.php';
const TEARDOWN_SCRIPT = '/tmp/revenant-it-challenge-costs-teardown.php';
const FIXTURE_FILE = '/tmp/revenant-it-challenge-costs-fixture.json';

function wpEvalFile(scriptPath: string): void {
	execFileSync(WP_CLI, ['eval-file', scriptPath, '--path=.'], { cwd: WP_PATH });
}

interface Fixture {
	connection_id: number;
	secret: string;
	challenger_character_id: number;
	defender_character_id: number;
}

describe("against the local Beyond Elysium site, a settled challenge's own costs", () => {
	let connection: { be_connection_id: number; rest_root: string; game_slug: string };
	let secret: Buffer;
	let challengerCharacterId: number;
	let defenderCharacterId: number;

	beforeAll(async () => {
		writeFileSync(
			SETUP_SCRIPT,
			`<?php
$slug = '${SLUG}';
if ( \\BeyondElysium\\Models\\Game::find_by_slug( $slug ) ) {
	\\BeyondElysium\\Models\\Game::delete_with_content( $slug );
}
$game_id = (int) \\BeyondElysium\\Models\\Game::create( [ 'slug' => $slug, 'name' => 'Revenant Challenge Cost Test' ] );

$connected = \\BeyondElysium\\Models\\Bot_Connection::connect( $game_id, 'it-guild', 'IT Guild', 1 );

foreach ( [ 'it-challenge-challenger', 'it-challenge-defender' ] as $login ) {
	$existing = get_user_by( 'login', $login );
	if ( $existing ) {
		wp_delete_user( $existing->ID );
	}
}
$challenger_user_id = \\wp_insert_user( [ 'user_login' => 'it-challenge-challenger', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
$defender_user_id = \\wp_insert_user( [ 'user_login' => 'it-challenge-defender', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $challenger_user_id, 'player' );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $defender_user_id, 'player' );

$challenger_character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Challenger', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'wp_user_id' => $challenger_user_id,
] );
$defender_character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Defender', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'wp_user_id' => $defender_user_id,
] );

$link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${CHALLENGER_DISCORD_ID}', 'it-challenger-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $link['link_id'] ), $challenger_user_id, [ $challenger_character_id ], true );
$defender_link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${DEFENDER_DISCORD_ID}', 'it-defender-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $defender_link['link_id'] ), $defender_user_id, [ $defender_character_id ], true );

file_put_contents( '${FIXTURE_FILE}', wp_json_encode( [
	'connection_id' => $connected['id'],
	'secret' => $connected['secret'],
	'challenger_character_id' => $challenger_character_id,
	'defender_character_id' => $defender_character_id,
] ) );
`
		);
		wpEvalFile(SETUP_SCRIPT);
		const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
		challengerCharacterId = fixture.challenger_character_id;
		defenderCharacterId = fixture.defender_character_id;
		const restRoot = await discoverRestRoot(SITE, { allowInsecureLocalhost: true });
		connection = { be_connection_id: fixture.connection_id, rest_root: restRoot, game_slug: SLUG };
		secret = Buffer.from(fixture.secret, 'base64url');
	});

	afterAll(() => {
		writeFileSync(
			TEARDOWN_SCRIPT,
			`<?php
\\BeyondElysium\\Models\\Game::delete_with_content( '${SLUG}' );
foreach ( [ 'it-challenge-challenger', 'it-challenge-defender' ] as $login ) {
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

	function target(wound?: CostTarget['wound']): CostTarget {
		return {
			challenger: { characterId: challengerCharacterId, discordUserId: CHALLENGER_DISCORD_ID },
			defender: { characterId: defenderCharacterId, discordUserId: DEFENDER_DISCORD_ID },
			reason: 'Lost a Physical challenge against IT Challenger',
			traitLocations: [
				{ trait: 'Brawl', blockSlug: 'vampire-abilities' },
				{ trait: 'Melee', blockSlug: 'vampire-abilities' },
			],
			abilityLocations: [{ trait: 'Occult', blockSlug: 'vampire-abilities' }],
			...(wound ? { wound } : {}),
		};
	}

	it('records a lost Trait on the loser', async () => {
		const outcome: Outcome = { loser: 'defender', lostTraits: ['Brawl'], expendedAbilities: [] };
		await applyCosts(connection, secret, outcome, target());

		const character = await fetchCharacterRaw(connection, secret, DEFENDER_DISCORD_ID, defenderCharacterId);
		const losses = readNightLosses(character.sheet_data);
		expect(losses.lost_traits.map((t) => t.name)).toContain('Brawl');
	});

	it('records a wound on the loser with armor folded into the reason', async () => {
		const outcome: Outcome = { loser: 'challenger', lostTraits: [], expendedAbilities: [] };
		await applyCosts(connection, secret, outcome, target({ type: 'lethal', amount: 2, armor: 1 }));

		const character = await fetchCharacterRaw(connection, secret, CHALLENGER_DISCORD_ID, challengerCharacterId);
		const wounds = readWounds(character.sheet_data);
		expect(wounds.lethal).toBeGreaterThanOrEqual(2);
	});

	it("reversing one lost Trait preserves a different challenge's own loss recorded the same night", async () => {
		await applyCosts(connection, secret, { loser: 'defender', lostTraits: ['Melee'], expendedAbilities: [] }, target());
		const applied = await applyCosts(connection, secret, { loser: 'defender', lostTraits: ['Brawl'], expendedAbilities: [] }, target());

		await reverseCost(connection, secret, applied[0]!, target(), 'Correcting a scoring mistake');

		const character = await fetchCharacterRaw(connection, secret, DEFENDER_DISCORD_ID, defenderCharacterId);
		const losses = readNightLosses(character.sheet_data);
		expect(losses.lost_traits.map((t) => t.name)).toContain('Melee');
		expect(losses.lost_traits.map((t) => t.name)).not.toContain('Brawl');
	});
});
