import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { commands } from '../src/commands/registry.js';
import { contextMenuCommands } from '../src/commands/contextMenus.js';

const config = loadConfig();
const rest = new REST().setToken(config.discordToken);
const everyCommand = [...commands, ...contextMenuCommands];
const body = everyCommand.map((command) => command.data.toJSON());

const route = config.devGuildId
	? Routes.applicationGuildCommands(config.discordApplicationId, config.devGuildId)
	: Routes.applicationCommands(config.discordApplicationId);

await rest.put(route, { body });

console.log(
	`Registered ${body.length} command(s)${config.devGuildId ? ` to guild ${config.devGuildId}` : ' globally'}: ${everyCommand
		.map((command) => command.data.name)
		.join(', ')}`
);
