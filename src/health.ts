import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';

export interface HealthCheck {
	discordReady: () => boolean;
	pool: Pool;
}

async function isHealthy(check: HealthCheck): Promise<boolean> {
	if (!check.discordReady()) {
		return false;
	}
	try {
		await check.pool.query('SELECT 1');
		return true;
	} catch {
		return false;
	}
}

/**
 * Starts the `/healthz` server: 200 while the bot is logged in to Discord and the database answers,
 * 503 otherwise. Bound to localhost only, for the container's own health check.
 */
export function startHealthServer(check: HealthCheck, port: number): Server {
	const server = createServer((request, response) => {
		if (request.url !== '/healthz') {
			response.writeHead(404);
			response.end();
			return;
		}
		isHealthy(check)
			.then((healthy) => {
				response.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
				response.end(JSON.stringify({ status: healthy ? 'ok' : 'unavailable' }));
			})
			.catch(() => {
				response.writeHead(503, { 'Content-Type': 'application/json' });
				response.end(JSON.stringify({ status: 'unavailable' }));
			});
	});
	server.listen(port, '127.0.0.1');
	return server;
}
