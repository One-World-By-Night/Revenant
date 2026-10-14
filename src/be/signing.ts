import { createHash, createHmac, randomBytes } from 'node:crypto';

export interface SignableRequest {
	method: string;
	route: string;
	query: Record<string, string>;
	timestamp: string;
	nonce: string;
	connectionId: string;
	discordUserId: string;
	body: string;
}

const UNRESERVED = /^[A-Za-z0-9\-_.~]$/;

/**
 * Encodes one value the way PHP's `rawurlencode` does: RFC 3986, operating on UTF-8 bytes, leaving only
 * `-_.~` unescaped.
 */
export function rawUrlEncode(value: string): string {
	const bytes = Buffer.from(value, 'utf8');
	let result = '';
	for (const byte of bytes) {
		const char = String.fromCharCode(byte);
		if (UNRESERVED.test(char)) {
			result += char;
		} else {
			result += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
		}
	}
	return result;
}

/**
 * Sorts a query's parameters by key in byte order and encodes each `key=value` pair, joined by `&`. The
 * bot never sends an array-valued parameter.
 */
export function canonicalQuery(query: Record<string, string>): string {
	const keys = Object.keys(query).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return keys.map((key) => `${rawUrlEncode(key)}=${rawUrlEncode(query[key] ?? '')}`).join('&');
}

/**
 * Builds the nine-line string that gets signed, exactly as Beyond Elysium 1.6.0 constructs it.
 */
export function canonicalString(request: SignableRequest): string {
	const bodyHash = createHash('sha256').update(request.body, 'utf8').digest('hex');
	return [
		'v1',
		request.method.toUpperCase(),
		request.route,
		canonicalQuery(request.query),
		request.timestamp,
		request.nonce,
		request.connectionId,
		request.discordUserId,
		bodyHash,
	].join('\n');
}

/**
 * Signs a canonical string with HMAC-SHA256, keyed with the connection's own decoded secret, as
 * lower-case hex.
 */
export function sign(canonical: string, secret: Buffer): string {
	return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

/**
 * Decodes a connection's secret from the base64url form it is carried in.
 */
export function decodeSecret(base64url: string): Buffer {
	return Buffer.from(base64url, 'base64url');
}

/**
 * A fresh nonce: 24 random bytes as base64url, unique enough that BE never sees it twice for one
 * connection.
 */
export function generateNonce(): string {
	return randomBytes(24).toString('base64url');
}
