import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalString, canonicalQuery, sign, decodeSecret, generateNonce } from '../../src/be/signing.js';

interface Vector {
	name: string;
	secret: string;
	method: string;
	route: string;
	query: Record<string, string>;
	timestamp: string;
	nonce: string;
	connection_id: string;
	discord_user_id: string;
	body: string;
	canonical: string;
	signature: string;
}

const VECTORS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../vectors/signing.json');
const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as Vector[];

describe('signing vectors', () => {
	it('loads at least one vector', () => {
		expect(vectors.length).toBeGreaterThan(0);
	});

	it.each(vectors)('$name', (vector) => {
		const built = canonicalString({
			method: vector.method,
			route: vector.route,
			query: vector.query,
			timestamp: vector.timestamp,
			nonce: vector.nonce,
			connectionId: vector.connection_id,
			discordUserId: vector.discord_user_id,
			body: vector.body,
		});
		expect(built).toBe(vector.canonical);

		const secret = decodeSecret(vector.secret);
		expect(sign(built, secret)).toBe(vector.signature);
	});
});

describe('canonicalQuery encoding', () => {
	it('encodes a space as %20, not +', () => {
		expect(canonicalQuery({ q: 'a b' })).toBe('q=a%20b');
	});

	it('leaves ~ unencoded', () => {
		expect(canonicalQuery({ q: '~stays~' })).toBe('q=~stays~');
	});

	it('encodes + as %2B', () => {
		expect(canonicalQuery({ q: 'a+b' })).toBe('q=a%2Bb');
	});

	it('encodes / as %2F', () => {
		expect(canonicalQuery({ q: 'a/b' })).toBe('q=a%2Fb');
	});

	it('encodes non-ASCII by UTF-8 byte, not code point', () => {
		expect(canonicalQuery({ q: 'é' })).toBe('q=%C3%A9');
	});

	it('sorts keys in byte order, not insertion order', () => {
		expect(canonicalQuery({ zebra: '1', apple: '2' })).toBe('apple=2&zebra=1');
	});

	it('refuses nothing for an empty query, returning an empty string', () => {
		expect(canonicalQuery({})).toBe('');
	});
});

describe('canonicalString body hashing', () => {
	it('hashes an empty body as the sha256 of the empty string', () => {
		const built = canonicalString({
			method: 'GET',
			route: '/be/v1/kony/my/characters',
			query: {},
			timestamp: '1700000000',
			nonce: 'n',
			connectionId: '1',
			discordUserId: '',
			body: '',
		});
		const expectedHash = createHash('sha256').update('', 'utf8').digest('hex');
		expect(built.split('\n').at(-1)).toBe(expectedHash);
	});

	it('hashes a non-empty body, not the empty-string hash', () => {
		const built = canonicalString({
			method: 'POST',
			route: '/be/v1/kony/discord-links/confirm',
			query: {},
			timestamp: '1700000000',
			nonce: 'n',
			connectionId: '1',
			discordUserId: '',
			body: '{"a":1}',
		});
		const emptyHash = createHash('sha256').update('', 'utf8').digest('hex');
		expect(built.split('\n').at(-1)).not.toBe(emptyHash);
	});
});

describe('generateNonce', () => {
	it('produces a base64url string with no padding or unsafe characters', () => {
		const nonce = generateNonce();
		expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('produces a different nonce each time', () => {
		const a = generateNonce();
		const b = generateNonce();
		expect(a).not.toBe(b);
	});

	it('decodes to 24 raw bytes', () => {
		const nonce = generateNonce();
		expect(Buffer.from(nonce, 'base64url').length).toBe(24);
	});
});
