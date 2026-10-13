# beRevenant

Revenant is a Discord bot for [Beyond Elysium](https://github.com/One-World-By-Night/BeyondElysium), the character management plugin for Mind's Eye Theatre LARP built for [One World by Night](https://www.owbn.net/).

**Status: designed, not built yet.** The design is in [docs/design.md](docs/design.md).

## What it's for

Beyond Elysium keeps a chronicle's sheets, approvals and downtime on its WordPress site. Revenant brings the chronicle into its Discord server:

- **Connect, link and sheets.** A Storyteller connects the server to the chronicle, players link their Discord accounts to their characters, and everyone can read their own sheet in Discord.
- **Challenges and dice.** Challenges under Laws of the Night Revised, settled on what each side claims, with hidden throws, ties, overbids, retests and the bomb. Dice in general notation and World of Darkness pools.
- **In-character posting.** Post as your character, with its name and portrait.
- **Tracking.** Willpower, Blood and other temporary points, Traits and Abilities spent in challenges, and wounds by type, straight onto the sheet.
- **Game night.** Check-in, after-action reports, downtimes, player rooms, and notifications from the chronicle.

Anything a Storyteller keeps private stays out of the channel.

## Commit checks

Run this once in a new clone:

```sh
git config core.hooksPath .githooks
```

The hooks refuse a commit whose message, files or file names credit a code-generation tool. The same check runs on GitHub for every push and pull request.

## License

GPL-2.0, the same as Beyond Elysium. See [LICENSE](LICENSE).
