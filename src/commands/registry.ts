import type { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type { Logger } from '../log.js';
import type { Config } from '../config.js';
import { connectCommand } from './connect.js';
import { disconnectCommand } from './disconnect.js';
import { linkCommand } from './link.js';
import { unlinkCommand } from './unlink.js';
import { linksCommand } from './links.js';
import { characterCommand } from './character.js';
import { sheetCommand } from './sheet.js';
import { rollCommand } from './roll.js';
import { settingsCommand } from './settings.js';
import { spendCommand } from './spend.js';
import { regainCommand } from './regain.js';
import { woundCommand } from './wound.js';
import { healCommand } from './heal.js';
import { statusCommand } from './status.js';
import { nightCommand } from './night.js';
import { challengeCommand } from './challenge.js';
import { challengesCommand } from './challenges.js';
import { staticCommand } from './static.js';
import { testCommand } from './test.js';
import { asCommand } from './as.js';
import { unlockCommand } from './unlock.js';
import { triggerCommand } from './trigger.js';
import { checkinCommand } from './checkin.js';
import { aarCommand } from './aar.js';
import { downtimeCommand } from './downtime.js';
import { sceneCommand } from './scene.js';
import { plotCommand } from './plot.js';
import { roomCommand } from './room.js';

export interface CommandContext {
	pool: Pool;
	logger: Logger;
	config: Config;
}

export interface BotCommand {
	data: SlashCommandBuilder;
	execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
	autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
}

export const commands: BotCommand[] = [
	connectCommand,
	disconnectCommand,
	linkCommand,
	unlinkCommand,
	linksCommand,
	characterCommand,
	sheetCommand,
	rollCommand,
	settingsCommand,
	spendCommand,
	regainCommand,
	woundCommand,
	healCommand,
	statusCommand,
	nightCommand,
	challengeCommand,
	challengesCommand,
	staticCommand,
	testCommand,
	asCommand,
	unlockCommand,
	triggerCommand,
	checkinCommand,
	aarCommand,
	downtimeCommand,
	sceneCommand,
	plotCommand,
	roomCommand,
];

/**
 * The command definition named for a Discord interaction's own command name, or undefined when it
 * names no command this bot has (should not happen once registration is current).
 */
export function findCommand(name: string): BotCommand | undefined {
	return commands.find((command) => command.data.name === name);
}
