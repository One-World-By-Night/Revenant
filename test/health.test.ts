import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { startHealthServer } from '../src/health.js';

let server: Server | undefined;

afterEach(() => {
	server?.close();
	server = undefined;
});

function waitForListening(s: Server): Promise<Server> {
	if (s.listening) {
		return Promise.resolve(s);
	}
	return new Promise((resolve) => s.once('listening', () => resolve(s)));
}

async function urlFor(s: Server, path: string): Promise<string> {
	await waitForListening(s);
	const { port } = s.address() as AddressInfo;
	return `http://127.0.0.1:${port}${path}`;
}

function fakePool(behavior: 'ok' | 'fails'): Pool {
	return {
		query: async () => {
			if (behavior === 'fails') {
				throw new Error('database unreachable');
			}
			return { rows: [{ '?column?': 1 }] };
		},
	} as unknown as Pool;
}

describe('startHealthServer', () => {
	it('answers 200 when Discord is ready and the database answers', async () => {
		server = startHealthServer({ discordReady: () => true, pool: fakePool('ok') }, 0);
		const response = await fetch(await urlFor(server, '/healthz'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('answers 503 when Discord is not ready', async () => {
		server = startHealthServer({ discordReady: () => false, pool: fakePool('ok') }, 0);
		const response = await fetch(await urlFor(server, '/healthz'));
		expect(response.status).toBe(503);
	});

	it('answers 503 when the database does not answer', async () => {
		server = startHealthServer({ discordReady: () => true, pool: fakePool('fails') }, 0);
		const response = await fetch(await urlFor(server, '/healthz'));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ status: 'unavailable' });
	});

	it('answers 404 for any other path', async () => {
		server = startHealthServer({ discordReady: () => true, pool: fakePool('ok') }, 0);
		const response = await fetch(await urlFor(server, '/'));
		expect(response.status).toBe(404);
	});
});
