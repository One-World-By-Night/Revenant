import { describe, it, expect, vi } from 'vitest';
import { callBe, CACHE_BUSTER } from '../../src/be/client.js';
import { canonicalString, sign } from '../../src/be/signing.js';

const REST_ROOT = 'https://example.test/wp-json/';
const SECRET = Buffer.alloc(32, 9);

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('callBe: a signed call', () => {
	it('sends the connection id, timestamp, nonce and signature headers', async () => {
		const fetchImpl = vi.fn(async (_url, init) => {
			const headers = init.headers as Record<string, string>;
			expect(headers['X-BE-Bot-Connection']).toBe('7');
			expect(headers['X-BE-Bot-Timestamp']).toMatch(/^\d+$/);
			expect(headers['X-BE-Bot-Nonce']).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(headers['X-BE-Bot-Signature']).toMatch(/^[0-9a-f]{64}$/);
			return jsonResponse(200, { ok: true });
		}) as unknown as typeof fetch;

		const result = await callBe<{ ok: boolean }>(
			REST_ROOT,
			{ method: 'GET', route: '/be/v1/kony/my/characters', signedAs: { connectionId: '7', secret: SECRET } },
			fetchImpl
		);
		expect(result).toEqual({ ok: true });
	});

	it('sends X-BE-Bot-User only when a Discord user is named', async () => {
		let seenHeaders: Record<string, string> = {};
		const fetchImpl = vi.fn(async (_url, init) => {
			seenHeaders = init.headers as Record<string, string>;
			return jsonResponse(200, {});
		}) as unknown as typeof fetch;

		await callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/bot/status', signedAs: { connectionId: '7', secret: SECRET } }, fetchImpl);
		expect(seenHeaders['X-BE-Bot-User']).toBeUndefined();

		await callBe(
			REST_ROOT,
			{ method: 'GET', route: '/be/v1/kony/my/characters', signedAs: { connectionId: '7', secret: SECRET, discordUserId: '123' } },
			fetchImpl
		);
		expect(seenHeaders['X-BE-Bot-User']).toBe('123');
	});

	it('appends the canonical query string to the URL', async () => {
		let seenUrl = '';
		const fetchImpl = vi.fn(async (url: string) => {
			seenUrl = url;
			return jsonResponse(200, {});
		}) as unknown as typeof fetch;

		await callBe(
			REST_ROOT,
			{
				method: 'GET',
				route: '/be/v1/kony/characters',
				query: { search: 'a b', page: '2' },
				signedAs: { connectionId: '7', secret: SECRET },
			},
			fetchImpl
		);
		expect(seenUrl).toMatch(/^https:\/\/example\.test\/wp-json\/be\/v1\/kony\/characters\?nocache=[A-Za-z0-9_-]+&page=2&search=a%20b$/);
	});

	it('puts a fresh cache-busting value on every signed GET, inside what it signs', async () => {
		const seen: { url: string; headers: Record<string, string> }[] = [];
		const fetchImpl = vi.fn(async (url: string, init) => {
			seen.push({ url, headers: init.headers as Record<string, string> });
			return jsonResponse(200, []);
		}) as unknown as typeof fetch;

		const options = { method: 'GET' as const, route: '/be/v1/kony/bot/notices', signedAs: { connectionId: '7', secret: SECRET } };
		await callBe(REST_ROOT, options, fetchImpl);
		await callBe(REST_ROOT, options, fetchImpl);

		const values = seen.map(({ url }) => new URL(url).searchParams.get(CACHE_BUSTER));
		expect(values[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
		expect(values[1]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
		expect(values[0]).not.toBe(values[1]);

		for (const { url, headers } of seen) {
			const canonical = canonicalString({
				method: 'GET',
				route: '/be/v1/kony/bot/notices',
				query: { [CACHE_BUSTER]: new URL(url).searchParams.get(CACHE_BUSTER) ?? '' },
				timestamp: headers['X-BE-Bot-Timestamp'] ?? '',
				nonce: headers['X-BE-Bot-Nonce'] ?? '',
				connectionId: '7',
				discordUserId: '',
				body: '',
			});
			expect(headers['X-BE-Bot-Signature']).toBe(sign(canonical, SECRET));
		}
	});

	it('gives a retried GET a new cache-busting value', async () => {
		const urls: string[] = [];
		const fetchImpl = vi.fn(async (url: string) => {
			urls.push(url);
			if (urls.length === 1) {
				throw new Error('ECONNRESET');
			}
			return jsonResponse(200, []);
		}) as unknown as typeof fetch;

		await callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/bot/notices', signedAs: { connectionId: '7', secret: SECRET } }, fetchImpl);

		expect(urls).toHaveLength(2);
		expect(urls[0]).not.toBe(urls[1]);
	});

	it('puts no cache-busting value on a signed write or an unsigned call', async () => {
		const urls: string[] = [];
		const fetchImpl = vi.fn(async (url: string) => {
			urls.push(url);
			return jsonResponse(200, {});
		}) as unknown as typeof fetch;

		await callBe(REST_ROOT, { method: 'POST', route: '/be/v1/kony/bot/notices/ack', body: { ids: [1] }, signedAs: { connectionId: '7', secret: SECRET } }, fetchImpl);
		await callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/bot/status' }, fetchImpl);

		expect(urls).toEqual(['https://example.test/wp-json/be/v1/kony/bot/notices/ack', 'https://example.test/wp-json/be/v1/kony/bot/status']);
	});

	it('serializes the body once and sets Content-Type', async () => {
		let seenBody: string | undefined;
		let seenHeaders: Record<string, string> = {};
		const fetchImpl = vi.fn(async (_url, init) => {
			seenBody = init.body as string;
			seenHeaders = init.headers as Record<string, string>;
			return jsonResponse(201, {});
		}) as unknown as typeof fetch;

		await callBe(
			REST_ROOT,
			{ method: 'POST', route: '/be/v1/kony/bot/links', body: { discord_user_id: '1' }, signedAs: { connectionId: '7', secret: SECRET } },
			fetchImpl
		);
		expect(seenBody).toBe('{"discord_user_id":"1"}');
		expect(seenHeaders['Content-Type']).toBe('application/json');
	});

	it('sets no Content-Type and no body for a bodyless call', async () => {
		let seenInit: RequestInit = {};
		const fetchImpl = vi.fn(async (_url, init) => {
			seenInit = init;
			return jsonResponse(200, {});
		}) as unknown as typeof fetch;

		await callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/bot/status', signedAs: { connectionId: '7', secret: SECRET } }, fetchImpl);
		expect(seenInit.body).toBeUndefined();
		expect((seenInit.headers as Record<string, string>)['Content-Type']).toBeUndefined();
	});
});

describe('callBe: an unsigned call', () => {
	it('sends no signing headers at all', async () => {
		let seenHeaders: Record<string, string> = {};
		const fetchImpl = vi.fn(async (_url, init) => {
			seenHeaders = init.headers as Record<string, string>;
			return jsonResponse(201, { connection_id: 1 });
		}) as unknown as typeof fetch;

		await callBe(REST_ROOT, { method: 'POST', route: '/be/v1/bot/connect', body: { code: 'ABC' } }, fetchImpl);
		expect(Object.keys(seenHeaders)).toEqual(['Content-Type']);
	});
});

describe('callBe: error classification', () => {
	it('classifies 401 bot_auth_failed as auth_failed', async () => {
		const fetchImpl = (async () => jsonResponse(401, { code: 'bot_auth_failed', message: 'nope' })) as unknown as typeof fetch;
		await expect(
			callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/my/characters', signedAs: { connectionId: '7', secret: SECRET } }, fetchImpl)
		).rejects.toMatchObject({ kind: 'auth_failed', httpStatus: 401, beCode: 'bot_auth_failed' });
	});

	it('classifies 403 bot_user_not_linked as user_not_linked', async () => {
		const fetchImpl = (async () => jsonResponse(403, { code: 'bot_user_not_linked' })) as unknown as typeof fetch;
		await expect(
			callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/my/characters' }, fetchImpl)
		).rejects.toMatchObject({ kind: 'user_not_linked' });
	});

	it.each(['bot_route_not_allowed', 'bot_wrong_chronicle'])('classifies 403 %s as bot_defect', async (code) => {
		const fetchImpl = (async () => jsonResponse(403, { code })) as unknown as typeof fetch;
		await expect(callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/x' }, fetchImpl)).rejects.toMatchObject({
			kind: 'bot_defect',
			beCode: code,
		});
	});

	it('passes through any other route error as route_error', async () => {
		const fetchImpl = (async () =>
			jsonResponse(400, { code: 'invalid_code', message: "That code didn't work." })) as unknown as typeof fetch;
		await expect(callBe(REST_ROOT, { method: 'POST', route: '/be/v1/bot/connect' }, fetchImpl)).rejects.toMatchObject({
			kind: 'route_error',
			httpStatus: 400,
			beCode: 'invalid_code',
			beMessage: "That code didn't work.",
		});
	});

	it('classifies a 404 with no recognised code as route_error', async () => {
		const fetchImpl = (async () => jsonResponse(404, { code: 'game_not_found' })) as unknown as typeof fetch;
		await expect(callBe(REST_ROOT, { method: 'GET', route: '/be/v1/nope/x' }, fetchImpl)).rejects.toMatchObject({
			kind: 'route_error',
			httpStatus: 404,
		});
	});
});

describe('callBe: retry and unreachable handling', () => {
	it('retries a failed GET once, then succeeds', async () => {
		let calls = 0;
		const fetchImpl = vi.fn(async () => {
			calls++;
			if (calls === 1) {
				throw new Error('ECONNRESET');
			}
			return jsonResponse(200, { ok: true });
		}) as unknown as typeof fetch;

		const result = await callBe<{ ok: boolean }>(REST_ROOT, { method: 'GET', route: '/be/v1/kony/bot/status' }, fetchImpl);
		expect(result).toEqual({ ok: true });
		expect(calls).toBe(2);
	});

	it('gives up after one retry on a GET, as unreachable', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('ECONNRESET');
		}) as unknown as typeof fetch;

		await expect(callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/bot/status' }, fetchImpl)).rejects.toMatchObject({
			kind: 'unreachable',
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('never retries a write, even on a network failure', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('ECONNRESET');
		}) as unknown as typeof fetch;

		await expect(
			callBe(REST_ROOT, { method: 'POST', route: '/be/v1/kony/bot/links' }, fetchImpl)
		).rejects.toMatchObject({ kind: 'unreachable' });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('treats a 5xx as unreachable and retries a GET once', async () => {
		let calls = 0;
		const fetchImpl = vi.fn(async () => {
			calls++;
			return jsonResponse(503, { code: 'internal_error' });
		}) as unknown as typeof fetch;

		await expect(callBe(REST_ROOT, { method: 'GET', route: '/be/v1/kony/bot/status' }, fetchImpl)).rejects.toMatchObject({
			kind: 'unreachable',
		});
		expect(calls).toBe(2);
	});

	it('treats a 5xx with an unparseable body as unreachable, not a crash', async () => {
		const fetchImpl = (async () =>
			new Response('<html>Internal Server Error</html>', { status: 500 })) as unknown as typeof fetch;
		await expect(callBe(REST_ROOT, { method: 'POST', route: '/be/v1/kony/bot/links' }, fetchImpl)).rejects.toMatchObject({
			kind: 'unreachable',
		});
	});
});
