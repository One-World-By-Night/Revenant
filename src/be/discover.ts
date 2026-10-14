const API_W_ORG_REL = /<([^>]+)>\s*;\s*rel="https:\/\/api\.w\.org\/"/;

/**
 * Adds `https://` when no scheme was typed, and drops a trailing slash.
 */
export function normalizeSite(input: string): string {
	const trimmed = input.trim();
	const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	return withScheme.replace(/\/+$/, '');
}

export class InsecureSiteError extends Error {
	constructor(site: string) {
		super(`${site} is not secure - only https:// sites are allowed, except localhost in development`);
		this.name = 'InsecureSiteError';
	}
}

function assertAllowedScheme(site: string, allowInsecureLocalhost: boolean): void {
	const url = new URL(site);
	if (url.protocol === 'https:') {
		return;
	}
	if (url.protocol === 'http:' && url.hostname === 'localhost' && allowInsecureLocalhost) {
		return;
	}
	throw new InsecureSiteError(site);
}

/**
 * Finds a chronicle's REST API root: normalizes the typed site, refuses an insecure one outside
 * development, requests the home page, and reads the root from its `Link` header - the one every
 * WordPress site sends - falling back to `{site}/wp-json/` when it is missing.
 */
export async function discoverRestRoot(
	input: string,
	options: { allowInsecureLocalhost: boolean },
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const site = normalizeSite(input);
	assertAllowedScheme(site, options.allowInsecureLocalhost);

	const response = await fetchImpl(site, { method: 'GET', redirect: 'follow' });
	const linkHeader = response.headers.get('link');
	if (linkHeader) {
		const match = linkHeader.match(API_W_ORG_REL);
		if (match?.[1]) {
			return match[1];
		}
	}
	return `${site}/wp-json/`;
}

/**
 * Builds the request URL for one BE route against a discovered REST root, handling both a plain root
 * (`{root}be/v1/{route}`) and a root of the `?rest_route=` form. `route` is the full canonical route
 * that gets signed, e.g. `/be/v1/kony/my/characters` - unchanged either way.
 */
export function buildRouteUrl(restRoot: string, route: string): string {
	if (restRoot.includes('?rest_route=')) {
		const [base] = restRoot.split('?rest_route=');
		return `${base}?rest_route=${route}`;
	}

	const trimmedRoot = restRoot.replace(/\/+$/, '');
	return `${trimmedRoot}${route}`;
}
