import { canonicalQuery, canonicalString, sign, generateNonce } from './signing.js';
import { buildRouteUrl } from './discover.js';

export type BeErrorKind = 'auth_failed' | 'user_not_linked' | 'bot_defect' | 'route_error' | 'unreachable';

const BOT_DEFECT_CODES = new Set(['bot_route_not_allowed', 'bot_wrong_chronicle']);
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * One typed error per kind of answer BE can give a signed call: `auth_failed` and `user_not_linked`
 * come from BE's own signing layer and can happen on any call; `bot_defect` means this bot sent a
 * request BE's allowlist does not expect, which is this code's own bug; `route_error` passes through
 * whatever the named route itself refused with; `unreachable` covers a timeout, a network failure, or
 * a 5xx with nothing more specific to say.
 */
export class BeApiError extends Error {
	constructor(
		public readonly kind: BeErrorKind,
		public readonly httpStatus: number | null,
		public readonly beCode: string | null,
		public readonly beMessage: string | null
	) {
		super(beMessage ?? `BE call failed (${kind})`);
		this.name = 'BeApiError';
	}
}

export interface SignedAs {
	connectionId: string;
	secret: Buffer;
	discordUserId?: string;
}

export interface BeCallOptions {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	route: string;
	query?: Record<string, string>;
	body?: unknown;
	signedAs?: SignedAs;
}

interface WpErrorBody {
	code?: string;
	message?: string;
	data?: { status?: number };
}

function appendQuery(url: string, query: string): string {
	if (query === '') {
		return url;
	}
	return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

async function doFetch(
	restRoot: string,
	options: BeCallOptions,
	fetchImpl: typeof fetch
): Promise<Response> {
	const query = options.query ?? {};
	const canonicalQueryString = canonicalQuery(query);
	const url = appendQuery(buildRouteUrl(restRoot, options.route), canonicalQueryString);
	const bodyString = options.body === undefined ? '' : JSON.stringify(options.body);

	const headers: Record<string, string> = {};
	if (bodyString !== '') {
		headers['Content-Type'] = 'application/json';
	}

	if (options.signedAs) {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		const nonce = generateNonce();
		const discordUserId = options.signedAs.discordUserId ?? '';
		const canonical = canonicalString({
			method: options.method,
			route: options.route,
			query,
			timestamp,
			nonce,
			connectionId: options.signedAs.connectionId,
			discordUserId,
			body: bodyString,
		});
		headers['X-BE-Bot-Connection'] = options.signedAs.connectionId;
		headers['X-BE-Bot-Timestamp'] = timestamp;
		headers['X-BE-Bot-Nonce'] = nonce;
		headers['X-BE-Bot-Signature'] = sign(canonical, options.signedAs.secret);
		if (discordUserId !== '') {
			headers['X-BE-Bot-User'] = discordUserId;
		}
	}

	const init: RequestInit = {
		method: options.method,
		headers,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	};
	if (bodyString !== '') {
		init.body = bodyString;
	}

	return fetchImpl(url, init);
}

function classify(status: number, body: WpErrorBody | null): BeApiError {
	const code = body?.code ?? null;
	const message = body?.message ?? null;

	if (status === 401 && code === 'bot_auth_failed') {
		return new BeApiError('auth_failed', status, code, message);
	}
	if (status === 403 && code === 'bot_user_not_linked') {
		return new BeApiError('user_not_linked', status, code, message);
	}
	if (status === 403 && code !== null && BOT_DEFECT_CODES.has(code)) {
		return new BeApiError('bot_defect', status, code, message);
	}
	if (status >= 500) {
		return new BeApiError('unreachable', status, code, message);
	}
	return new BeApiError('route_error', status, code, message);
}

/**
 * Makes one call to Beyond Elysium, signed when `signedAs` is given. Retries once, for a GET only,
 * on a timeout, a network failure, or a 5xx; never retries a write.
 */
export async function callBe<T>(
	restRoot: string,
	options: BeCallOptions,
	fetchImpl: typeof fetch = fetch
): Promise<T> {
	const canRetry = options.method === 'GET';
	let lastError: BeApiError | null = null;

	for (let attempt = 0; attempt < (canRetry ? 2 : 1); attempt++) {
		let response: Response;
		try {
			response = await doFetch(restRoot, options, fetchImpl);
		} catch {
			lastError = new BeApiError('unreachable', null, null, null);
			continue;
		}

		if (response.ok) {
			return (await response.json()) as T;
		}

		let body: WpErrorBody | null = null;
		try {
			body = (await response.json()) as WpErrorBody;
		} catch {
			body = null;
		}

		const error = classify(response.status, body);
		if (error.kind !== 'unreachable') {
			throw error;
		}
		lastError = error;
	}

	throw lastError ?? new BeApiError('unreachable', null, null, null);
}
