import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { commands } from '../src/commands/registry.js';

const config = loadConfig();
const rest = new REST().setToken(config.discordToken);
const body = commands.map((command) => command.data.toJSON());

const route = config.devGuildId
	? Routes.applicationGuildCommands(config.discordApplicationId, config.devGuildId)
	: Routes.applicationCommands(config.discordApplicationId);

await rest.put(route, { body });

console.log(
	`Registered ${body.length} command(s)${config.devGuildId ? ` to guild ${config.devGuildId}` : ' globally'}: ${commands
		.map((command) => command.data.name)
		.join(', ')}`
);
