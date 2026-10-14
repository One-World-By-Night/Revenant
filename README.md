# beRevenant

Revenant is a Discord bot for [Beyond Elysium](https://github.com/One-World-By-Night/BeyondElysium), the character management plugin for Mind's Eye Theatre LARP built for [One World by Night](https://www.owbn.net/).

**Status: step 1 (foundations) built.** The design is in [docs/design.md](docs/design.md); the build spec and its running status are in [docs/build/step-1.md](docs/build/step-1.md).

## What it's for

Beyond Elysium keeps a chronicle's sheets, approvals and downtime on its WordPress site. Revenant brings the chronicle into its Discord server:

- **Connect, link and sheets.** A Storyteller connects the server to the chronicle, players link their Discord accounts to their characters, and everyone can read their own sheet in Discord.
- **Challenges and dice.** Challenges under Laws of the Night Revised, settled on what each side claims, with hidden throws, ties, overbids, retests and the bomb. Dice in general notation and World of Darkness pools.
- **In-character posting.** Post as your character, with its name and portrait.
- **Tracking.** Willpower, Blood and other temporary points, Traits and Abilities spent in challenges, and wounds by type, straight onto the sheet.
- **Game night.** Check-in, after-action reports, downtimes, player rooms, and notifications from the chronicle.

Anything a Storyteller keeps private stays out of the channel.

Step 1 ships connect, link, sheets, dice and settings. Challenges, in-character posting and game night are later steps - see [docs/design.md](docs/design.md) for the full plan.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/connect site:<url> code:<code>` | A server manager | Connects this Discord server to a chronicle, using a one-time code from its Chronicle Setup |
| `/disconnect` | A server manager | Disconnects this server from its chronicle, with a confirm step |
| `/link` | Anyone | Starts, or checks on, a request to link your Discord account to your characters |
| `/unlink` | A linked player | Unlinks your Discord account, with a confirm step |
| `/links [status]` | Storytellers | Lists link requests waiting for an answer (default) or already approved, with Approve/Decline/Revoke buttons |
| `/character [name]` | A linked player | Shows your active character, or sets it from your linked characters |
| `/sheet [character] [section] [public]` | A linked player, or a Storyteller for any character | Shows a character's sheet, or one section of it; `public:true` posts it in the channel (your own character only) |
| `/roll <dice> [label]` or `/roll pool:<n> difficulty:<d> [specialty] [label]` | Anyone | Rolls general dice notation or a World of Darkness pool, and posts the result |
| `/settings` | Storytellers | Shows or changes this chronicle's pool rules, staff channel and public-post language |

General dice notation: `2d6+3`, `d100`, `4d6kh3` (keep highest 3), `4d6dl1` (drop lowest 1), `4d6!` (exploding), joined with `+`/`-`. World of Darkness pools: 1-30 dice, difficulty 2-10 (default 6), Revised or V20 rules (set with `/settings`).

## Running it

### Requirements

- Node 22, and Docker if you want to run it the same way it runs in production.
- A Discord application with a bot user, from the [Discord developer portal](https://discord.com/developers/applications). Create one, add a bot to it, and copy its token and application id.
- A Postgres 16 database.

### Configuration

Copy `.env.example` to `.env` and fill it in. `DATABASE_URL`, `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` and `SECRET_KEY` are required; generate `SECRET_KEY` with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set `DEV_GUILD_ID` to a test server's id while developing, so command changes show up at once instead of waiting up to an hour for a global registration.

### In containers (matches production)

```sh
docker compose up --build
```

This builds the bot, starts Postgres, runs the database migrations, and brings both up. The `bot` service reads its own `/healthz` over `localhost` only, by design - it's for the container's own healthcheck, not reachable from outside it.

### Locally, for development

```sh
npm ci
npm run register   # registers the slash commands (to DEV_GUILD_ID if set, else globally)
npm run dev        # runs the bot directly with tsx, no build step
```

### Checks

```sh
npm run check      # typecheck, lint, unit tests - run this before every commit
npm run test:be    # integration tests against a real local Beyond Elysium site (see below)
```

`test:be` needs a local Beyond Elysium site running Beyond Elysium 1.6.0 or newer, reachable at the URL `test/integration/be.test.ts` points at. It creates and deletes its own disposable chronicle on that site for the duration of the run - never point it at a site you don't own.

### Inviting the bot

Build the invite URL from the Discord developer portal (OAuth2 > URL Generator), with:

- **Scopes:** `bot`, `applications.commands`
- **Bot permissions:** View Channels, Send Messages, Embed Links (permissions integer `19456`)

Step 1's commands don't need anything past that. In-character posting (a later step) will add Manage Webhooks, Manage Messages and the Message Content privileged intent - don't request those yet.

## Backups

```sh
DATABASE_URL=postgres://... scripts/backup.sh
```

Dumps the database to a timestamped, gzipped file under `./backups` (override with `BACKUP_DIR`), and deletes anything older than 14 days (override with `BACKUP_RETAIN_DAYS`). If the `pg_dump` on `PATH` is older than the database server, point `PG_DUMP` at a newer one - `pg_dump` refuses to dump a server newer than itself.

A nightly cron line:

```cron
0 3 * * * cd /path/to/beRevenant && DATABASE_URL=postgres://... scripts/backup.sh >> /var/log/berevenant-backup.log 2>&1
```

To restore a backup, onto an empty database:

```sh
gunzip -c backups/berevenant-<timestamp>.sql.gz | psql "$DATABASE_URL"
```

## Commit checks

Run this once in a new clone:

```sh
git config core.hooksPath .githooks
```

The hooks refuse a commit whose message, files or file names credit a code-generation tool. The same check runs on GitHub for every push and pull request.

## License

GPL-2.0, the same as Beyond Elysium. See [LICENSE](LICENSE).
