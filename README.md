# beRevenant

Revenant is a Discord bot for [Beyond Elysium](https://github.com/One-World-By-Night/BeyondElysium), the character management plugin for Mind's Eye Theatre LARP built for [One World by Night](https://www.owbn.net/).

## What it's for

Beyond Elysium keeps a chronicle's sheets, approvals and downtime on its WordPress site. Revenant brings the chronicle into its Discord server:

- **Connect, link and sheets.** A Storyteller connects the server to the chronicle, players link their Discord accounts to their characters, and everyone can read their own sheet in Discord.
- **Challenges and dice.** Challenges under Laws of the Night Revised, settled on what each side claims, with hidden throws, ties, overbids, retests and the bomb. Dice in general notation and World of Darkness pools.
- **Temporary state.** Spending or regaining pool points, wounds by type with an armor split, and the night's losses - every write logged, never needing approval.
- **In-character posting.** Post as your character, with its name and portrait, through a trigger, a lock, or `/as` for one message.
- **Game night.** Check-in, after-action reports, downtimes, player rooms, and notifications from the chronicle - to a player's own room or a direct message, and to the staff channel for staff notices.

Beyond Elysium stays the source of truth for characters, links, permissions and rules. Revenant is a window onto it: every command runs as the real linked account, so every permission and approval rule applies exactly as it does on the website. The bot keeps only what Discord itself needs.

One bot serves every chronicle. One Discord server connects to one chronicle.

## Commands

### Connecting and linking

| Command | Who | What it does |
| --- | --- | --- |
| `/connect site:<url> code:<code>` | A server manager | Connects this server to a chronicle, using a one-time code from its Chronicle Setup |
| `/disconnect` | A server manager | Disconnects this server from its chronicle |
| `/link` | Anyone | Asks to link your Discord account to your characters; a Storyteller is linked right away |
| `/unlink` | A linked player | Clears your own link |
| `/links status:<waiting\|approved>` | Storytellers | Reviews pending link requests (Approve/Decline) or manages approved ones (Revoke) |
| `/settings` | Storytellers | The Trait cap, challenge timeout, staff channel, in-character channels, pool rules, and role sync |

### Characters and sheets

| Command | Who | What it does |
| --- | --- | --- |
| `/character name:<character>` | A linked player | Shows or changes your active character |
| `/sheet` | A linked player, staff for any character | Shows a character's sheet |
| Who's Who (right-click → Apps) | Anyone | Shows a poster's public profile, if they have one |
| Who posted this? (right-click → Apps) | Staff | Shows who really sent a proxied in-character post |

### Temporary state

| Command | Who | What it does |
| --- | --- | --- |
| `/spend pool:<name>`, `/regain pool:<name>` | A linked player | Spends or regains a point of a temporary pool, logged automatically |
| `/wound type:<bashing\|lethal\|aggravated> amount:<n> armor:<n>` | A linked player | Takes damage, with the armor part logged separately |
| `/heal type:<...> amount:<n>` | A linked player | Heals damage by type |
| `/status` | A linked player | Pools, health, and tonight's losses |
| `/night open`, `/night close` | Storytellers | Opens or closes the session; closing restores lost Traits and expended Abilities |

### Challenges

| Command | Who | What it does |
| --- | --- | --- |
| `/challenge opponent:<user> category:<...> conditions:<text>` | A linked player | Challenges another linked player |
| `/static narrator:<user> category:<...> conditions:<text>` | A linked player | A challenge against a Narrator or Storyteller's claimed difficulty |
| `/test` | A linked player | A simple pass/fail test |
| `/challenges` | A linked player | Your own open or recent challenges |

### In-character posting

| Command | Who | What it does |
| --- | --- | --- |
| `/as character:<name> message:<text> lock:<true\|false>` | A linked player, staff for their NPCs | Posts as a character through the channel's webhook; locking keeps every message in-character until `/unlock` |
| `/unlock` | A linked player | Clears your own lock |

A trigger prefix or channel autoproxy, set with `/settings`, posts in-character automatically without `/as`.

### Game night

| Command | Who | What it does |
| --- | --- | --- |
| `/checkin` | A linked player | Checks in to the open session |
| `/aar` | A linked player | Files an after-action report |
| `/downtime list`, `/downtime post plot:<name> action:<text>` | A linked player | Lists and posts to your own downtime plots |
| `/scene plot:<name>` | A linked player, staff | Logs a scene to a plot, bypassing the downtime window |
| `/plot name:<name>` | A linked player, staff | Reads a plot you can see, with its entries |
| `/room point\|create\|clear player:<user>` | Storytellers | Points, creates, or clears a linked player's room |

### Dice and help

| Command | Who | What it does |
| --- | --- | --- |
| `/roll dice:<notation>` or `/roll pool:<n> difficulty:<n>` | Anyone | General dice notation, or a World of Darkness pool |
| `/help topic:<area>` | Anyone | An overview of every command, or detail on one area |

General dice notation: `2d6+3`, `d100`, `4d6kh3` (keep highest 3), `4d6dl1` (drop lowest 1), `4d6!` (exploding), joined with `+`/`-`. World of Darkness pools: 1-30 dice, difficulty 2-10, Revised or V20 rules (set with `/settings`).

## Challenges

The rules are Laws of the Night Revised (Chapter Five). The bot settles a challenge on what each side claims - it never looks up powers, merits or modifiers. The challenger states the terms (the conditions, the category, which sources may retest); both sides claim their Trait count, whether they have the bomb, and their retest source, within those terms. Both throw a hidden gesture (Rock, Paper, Scissors, and the bomb for a side that claimed it), revealed together. A tie is settled by the claimed counts. The loser loses the bid Trait for the night, may overbid by risking a new one, and either side may retest with a claimed source the other can block with a matching one.

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
npm run dev         # runs the bot directly with tsx, no build step
```

### Checks

```sh
npm run check      # typecheck, lint, unit tests - run this before every commit
npm run test:be    # integration tests against a real local Beyond Elysium site (see below)
```

`test:be` needs a local Beyond Elysium site running Beyond Elysium 1.6 or newer, reachable at the URL `test/integration/be.test.ts` points at. It creates and deletes its own disposable chronicle on that site for the duration of the run - never point it at a site you don't own.

### Inviting the bot

Build the invite URL from the Discord developer portal (OAuth2 > URL Generator), with:

- **Scopes:** `bot`, `applications.commands`
- **Bot permissions:** Send Messages, Embed Links, Read Message History, Manage Webhooks, Manage Messages, Manage Channels, Manage Roles

### Discord permissions and intents

- **Permissions:** Send Messages, Embed Links, Read Message History and Use Application Commands for every command; Manage Webhooks and Manage Messages for in-character posting; Manage Channels and Manage Roles for player rooms and role sync.
- **Intents.** Message Content (privileged) is needed to read triggers and locked posting. Past 100 servers, Discord requires the bot to be verified.

## Calling Beyond Elysium

Every request from the bot to BE is signed with the chronicle's own shared secret: an HMAC over a timestamp, a nonce and the body. Expired or replayed requests are refused. Each request names the Discord user it acts for; BE checks the signature, the chronicle, and that the user has an approved link, then runs the request as that user's own account, through BE's existing routes, on an allowlist. So every permission, approval rule, accessSchema role and Storyteller-only filter applies exactly as it does on the website.

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
