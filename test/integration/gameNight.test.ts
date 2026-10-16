import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { discoverRestRoot } from '../../src/be/discover.js';
import { BeApiError } from '../../src/be/client.js';
import { createSession } from '../../src/be/temporaryState.js';
import {
	checkIn,
	createReport,
	fetchMyPlots,
	downtimePlots,
	postAction,
	postScene,
	searchPlots,
	fetchPlotWithEntries,
} from '../../src/be/gameNight.js';

const WP_PATH = '/Users/greghacke/owbn/_localwp';
const WP_CLI = '/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp';
const SITE = 'http://localhost:8910';
const SLUG = 'revenant-it-game-night';
const DISCORD_USER_ID = 'it-test-game-night-player';
const HST_DISCORD_USER_ID = 'it-test-game-night-hst';
const SETUP_SCRIPT = '/tmp/revenant-it-game-night-setup.php';
const TEARDOWN_SCRIPT = '/tmp/revenant-it-game-night-teardown.php';
const FIXTURE_FILE = '/tmp/revenant-it-game-night-fixture.json';

function wpEvalFile(scriptPath: string): void {
	execFileSync(WP_CLI, ['eval-file', scriptPath, '--path=.'], { cwd: WP_PATH });
}

interface Fixture {
	game_id: number;
	character_id: number;
	connection_id: number;
	secret: string;
	own_plot_title: string;
}

/**
 * A real round trip against the local Beyond Elysium site for step 5's own routes - the bot's signed
 * calls for self check-in, after-action reports, the My Plots allocation flag, and action/scene
 * entries, through the real `Bot_Auth` allowlist and dispatch, not just against fixtures and mocks.
 */
describe("against the local Beyond Elysium site, step 5's game-night tools", () => {
	let connection: { be_connection_id: number; rest_root: string; game_slug: string };
	let secret: Buffer;
	let characterId: number;
	let ownPlotTitle: string;

	beforeAll(async () => {
		writeFileSync(
			SETUP_SCRIPT,
			`<?php
$slug = '${SLUG}';
if ( \\BeyondElysium\\Models\\Game::find_by_slug( $slug ) ) {
	\\BeyondElysium\\Models\\Game::delete_with_content( $slug );
}
$game_id = (int) \\BeyondElysium\\Models\\Game::create( [ 'slug' => $slug, 'name' => 'Revenant Game Night Test' ] );

$connected = \\BeyondElysium\\Models\\Bot_Connection::connect( $game_id, 'it-guild', 'IT Guild', 1 );

foreach ( [ 'it-game-night-player', 'it-game-night-hst' ] as $login ) {
	$existing = get_user_by( 'login', $login );
	if ( $existing ) {
		wp_delete_user( $existing->ID );
	}
}
$player_id = \\wp_insert_user( [ 'user_login' => 'it-game-night-player', 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $player_id, 'player' );
$hst_id = \\wp_insert_user( [ 'user_login' => 'it-game-night-hst', 'user_pass' => wp_generate_password(), 'role' => 'editor' ] );
\\BeyondElysium\\Models\\Game_Member::set_role( $game_id, $hst_id, 'hst' );

$character_id = (int) \\BeyondElysium\\Models\\Character::create( [
	'name' => 'IT Game Night Character', 'stack_slug' => 'vampire', 'owner_type' => 'chronicle', 'owner_slug' => $slug,
	'wp_user_id' => $player_id,
] );
$own_plot_title = \\BeyondElysium\\Models\\Character::plot_title( 'IT Game Night Character', $character_id );

$link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${DISCORD_USER_ID}', 'it-game-night-player-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $link['link_id'] ), $player_id, [ $character_id ], true );
$hst_link = \\BeyondElysium\\Models\\Discord_Link::start_or_renew( $game_id, '${HST_DISCORD_USER_ID}', 'it-game-night-hst-discord' );
\\BeyondElysium\\Models\\Discord_Link::confirm( \\BeyondElysium\\Models\\Discord_Link::find( $hst_link['link_id'] ), $hst_id, [], true );

file_put_contents( '${FIXTURE_FILE}', wp_json_encode( [
	'game_id' => $game_id,
	'character_id' => $character_id,
	'connection_id' => $connected['id'],
	'secret' => $connected['secret'],
	'own_plot_title' => $own_plot_title,
] ) );
`
		);
		wpEvalFile(SETUP_SCRIPT);
		const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
		characterId = fixture.character_id;
		ownPlotTitle = fixture.own_plot_title;
		const restRoot = await discoverRestRoot(SITE, { allowInsecureLocalhost: true });
		connection = { be_connection_id: fixture.connection_id, rest_root: restRoot, game_slug: SLUG };
		secret = Buffer.from(fixture.secret, 'base64url');
	});

	afterAll(() => {
		writeFileSync(
			TEARDOWN_SCRIPT,
			`<?php
\\BeyondElysium\\Models\\Game::delete_with_content( '${SLUG}' );
foreach ( [ 'it-game-night-player', 'it-game-night-hst' ] as $login ) {
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

	it('signs a real character in, then refuses a second sign-in for the same session', async () => {
		const session = await createSession(connection, secret, HST_DISCORD_USER_ID, '2026-10-16');

		const attendance = await checkIn(connection, secret, DISCORD_USER_ID, session.id, characterId);
		expect(Number(attendance.character_id)).toBe(characterId);

		await expect(checkIn(connection, secret, DISCORD_USER_ID, session.id, characterId)).rejects.toMatchObject({ httpStatus: 409 });
	});

	it('files a real after-action report, then refuses a second one for the same session', async () => {
		const session = await createSession(connection, secret, HST_DISCORD_USER_ID, '2026-10-15');

		const report = await createReport(connection, secret, DISCORD_USER_ID, session.id, characterId, {
			did: 'Watched the docks.',
			wants: 'A quiet night.',
			toStaff: '',
		});
		expect(Number(report.character_id)).toBe(characterId);

		await expect(
			createReport(connection, secret, DISCORD_USER_ID, session.id, characterId, { did: 'Again.', wants: '', toStaff: '' })
		).rejects.toMatchObject({ httpStatus: 409 });
	});

	it("flags the character's own auto-created plot as an action allocation in My Plots, with a real numeric id", async () => {
		const plots = await fetchMyPlots(connection, secret, DISCORD_USER_ID);
		const ownPlot = plots.find((plot) => plot.title === ownPlotTitle);

		expect(ownPlot).toBeDefined();
		expect(ownPlot?.is_action_allocation).toBe(true);
		expect(downtimePlots(plots).map((plot) => plot.title)).toContain(ownPlotTitle);

		// BE's own JSON serializes a plot id as a string - every command comparing by id, the way
		// `/downtime post` and `/scene` both do, needs fetchMyPlots to have already coerced it to a
		// real number or that comparison always fails.
		expect(typeof ownPlot?.id).toBe('number');
		const foundById = plots.find((plot) => plot.id === ownPlot?.id);
		expect(foundById).toBe(ownPlot);
	});

	it('posts a real action entry to the own allocation plot', async () => {
		const plots = await fetchMyPlots(connection, secret, DISCORD_USER_ID);
		const ownPlot = plots.find((plot) => plot.title === ownPlotTitle);

		const entry = await postAction(connection, secret, DISCORD_USER_ID, ownPlot!.id, 'I keep watch all night.');
		expect(entry.entry_type).toBe('action');
	});

	it('posts a real scene entry to the own allocation plot', async () => {
		const plots = await fetchMyPlots(connection, secret, DISCORD_USER_ID);
		const ownPlot = plots.find((plot) => plot.title === ownPlotTitle);

		const entry = await postScene(connection, secret, DISCORD_USER_ID, ownPlot!.id, 'Corwin Ashe: I watch the docks.');
		expect(entry.entry_type).toBe('scene');
	});

	it('refuses a scene signed by a Discord user with no connection to the plot', async () => {
		await expect(postScene(connection, secret, 'it-game-night-stranger', 1, 'Nobody.')).rejects.toThrow(BeApiError);
	});

	it('finds the own plot by title search, then reads it back with the entries already posted', async () => {
		const found = await searchPlots(connection, secret, DISCORD_USER_ID, 'IT Game Night Character');
		const match = found.find((plot) => plot.title === ownPlotTitle);
		expect(match).toBeDefined();

		const plot = await fetchPlotWithEntries(connection, secret, DISCORD_USER_ID, match!.id);
		expect(plot.title).toBe(ownPlotTitle);
		const contents = plot.entries.map((entry) => entry.content);
		expect(contents).toContain('I keep watch all night.');
		expect(contents).toContain('Corwin Ashe: I watch the docks.');
	});

	it("refuses to read a plot the signed-in user's audience excludes", async () => {
		const stOnlyScript = '/tmp/revenant-it-game-night-st-only-plot.php';
		const stOnlyFixture = '/tmp/revenant-it-game-night-st-only-plot-fixture.json';
		writeFileSync(
			stOnlyScript,
			`<?php
$game = \\BeyondElysium\\Models\\Game::find_by_slug('${SLUG}');
$id = (int) \\BeyondElysium\\Models\\Plot::create([
	'game_id' => (int) $game->id, 'title' => 'IT ST-Only Plot', 'initiated_by' => 'st',
	'created_by' => 1, 'audience' => 'storytellers',
]);
file_put_contents('${stOnlyFixture}', wp_json_encode(['plot_id' => $id]));
`
		);
		wpEvalFile(stOnlyScript);
		const { plot_id: plotId } = JSON.parse(readFileSync(stOnlyFixture, 'utf8')) as { plot_id: number };
		rmSync(stOnlyScript, { force: true });
		rmSync(stOnlyFixture, { force: true });

		await expect(fetchPlotWithEntries(connection, secret, DISCORD_USER_ID, plotId)).rejects.toMatchObject({ httpStatus: 404 });
	});
});
