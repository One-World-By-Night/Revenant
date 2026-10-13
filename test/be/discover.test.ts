import { describe, it, expect } from 'vitest';
import { normalizeSite, discoverRestRoot, buildRouteUrl, InsecureSiteError } from '../../src/be/discover.js';

function fakeFetch(linkHeader: string | null): typeof fetch {
	return (async () =>
		new Response(null, {
			status: 200,
			headers: linkHeader ? { Link: linkHeader } : {},
		})) as unknown as typeof fetch;
}

describe('normalizeSite', () => {
	it('adds https:// when no scheme is given', () => {
		expect(normalizeSite('example.test')).toBe('https://example.test');
	});

	it('leaves an https:// scheme as given', () => {
		expect(normalizeSite('https://example.test')).toBe('https://example.test');
	});

	it('leaves an http:// scheme as given, for the localhost check to judge', () => {
		expect(normalizeSite('http://localhost:8910')).toBe('http://localhost:8910');
	});

	it('drops one trailing slash', () => {
		expect(normalizeSite('https://example.test/')).toBe('https://example.test');
	});

	it('drops several trailing slashes', () => {
		expect(normalizeSite('https://example.test///')).toBe('https://example.test');
	});

	it('trims surrounding whitespace', () => {
		expect(normalizeSite('  example.test  ')).toBe('https://example.test');
	});
});

describe('discoverRestRoot', () => {
	it('refuses http:// on a non-localhost site', async () => {
		await expect(
			discoverRestRoot('http://example.test', { allowInsecureLocalhost: false })
		).rejects.toThrow(InsecureSiteError);
	});

	it('refuses http://localhost when the flag is off', async () => {
		await expect(
			discoverRestRoot('http://localhost:8910', { allowInsecureLocalhost: false })
		).rejects.toThrow(InsecureSiteError);
	});

	it('allows http://localhost when the flag is on', async () => {
		const root = await discoverRestRoot(
			'http://localhost:8910',
			{ allowInsecureLocalhost: true },
			fakeFetch('<http://localhost:8910/wp-json/>; rel="https://api.w.org/"')
		);
		expect(root).toBe('http://localhost:8910/wp-json/');
	});

	it('reads the REST root from the Link header', async () => {
		const root = await discoverRestRoot(
			'example.test',
			{ allowInsecureLocalhost: false },
			fakeFetch('<https://example.test/wp-json/>; rel="https://api.w.org/"')
		);
		expect(root).toBe('https://example.test/wp-json/');
	});

	it('reads the right entry when the Link header carries several, comma-separated', async () => {
		const root = await discoverRestRoot(
			'example.test',
			{ allowInsecureLocalhost: false },
			fakeFetch(
				'<https://example.test/feed/>; rel="alternate", <https://example.test/wp-json/>; rel="https://api.w.org/"'
			)
		);
		expect(root).toBe('https://example.test/wp-json/');
	});

	it('reads the ?rest_route= form from the Link header', async () => {
		const root = await discoverRestRoot(
			'example.test',
			{ allowInsecureLocalhost: false },
			fakeFetch('<https://example.test/?rest_route=/>; rel="https://api.w.org/"')
		);
		expect(root).toBe('https://example.test/?rest_route=/');
	});

	it('falls back to {site}/wp-json/ when there is no Link header', async () => {
		const root = await discoverRestRoot('example.test', { allowInsecureLocalhost: false }, fakeFetch(null));
		expect(root).toBe('https://example.test/wp-json/');
	});

	it('falls back when the Link header has no api.w.org entry', async () => {
		const root = await discoverRestRoot(
			'example.test',
			{ allowInsecureLocalhost: false },
			fakeFetch('<https://example.test/feed/>; rel="alternate"')
		);
		expect(root).toBe('https://example.test/wp-json/');
	});
});

describe('buildRouteUrl', () => {
	const route = '/be/v1/kony/my/characters';

	it('builds a URL against a plain REST root', () => {
		expect(buildRouteUrl('https://example.test/wp-json/', route)).toBe(
			'https://example.test/wp-json/be/v1/kony/my/characters'
		);
	});

	it('builds a URL against a ?rest_route= REST root, keeping the same signed route', () => {
		expect(buildRouteUrl('https://example.test/?rest_route=/', route)).toBe(
			'https://example.test/?rest_route=/be/v1/kony/my/characters'
		);
	});

	it('drops a trailing slash from a plain root before appending the route', () => {
		expect(buildRouteUrl('https://example.test/wp-json', route)).toBe(
			'https://example.test/wp-json/be/v1/kony/my/characters'
		);
	});
});
