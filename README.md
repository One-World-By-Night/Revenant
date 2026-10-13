# beBot

A Discord bot for [Beyond Elysium](https://github.com/One-World-By-Night/BeyondElysium), the character management plugin for Mind's Eye Theatre LARP built for [One World by Night](https://www.owbn.net/).

**Status: planning.** There's no code here yet.

## What it's for

Beyond Elysium keeps a chronicle's sheets, approvals and downtime on its WordPress site. beBot brings that into the Discord server where the chronicle already talks.

- **Challenges.** Throw rock-paper-scissors (with the bomb) or compare traits against another character. Both sides lock in privately, the bot reveals the throws together, and the traits and tie-winning powers come straight from both sheets.
- **Reminders.** "Downtime closes tomorrow" for players and "something is waiting in the queue" for Storytellers, posted in the chronicle's channel.
- **The sheet from Discord.** Look things up and file changes from a slash command, against the same sheet and the same approval rules as the website.

Anything a Storyteller keeps private stays out of the channel.

## Commit checks

Run this once in a new clone:

```
git config core.hooksPath .githooks
```

The hooks refuse a commit whose message, files or file names credit a code-generation tool. The same check runs on GitHub for every push and pull request.

## License

GPL-2.0, the same as Beyond Elysium. See [LICENSE](LICENSE).
