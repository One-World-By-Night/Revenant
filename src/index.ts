import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { startHealthServer } from './health.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

const pool = createPool(config.databaseUrl);

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'db/migrations');
const applied = await runMigrations(pool, migrationsDir);
if (applied.length > 0) {
	logger.info({ applied }, 'ran pending migrations');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', (readyClient) => {
	logger.info({ user: readyClient.user.tag }, 'logged in to Discord');
});

client.on('error', (error) => {
	logger.error({ error: error.message }, 'Discord client error');
});

startHealthServer({ discordReady: () => client.isReady(), pool }, config.healthPort);
logger.info({ port: config.healthPort }, 'health server listening');

try {
	await client.login(config.discordToken);
} catch (error) {
	logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Discord login failed');
}
