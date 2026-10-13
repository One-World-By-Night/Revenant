export interface TtlCache<V> {
	get(key: string, now?: number): V | undefined;
	set(key: string, value: V, now?: number): void;
}

/**
 * An in-memory, per-process cache where each entry expires `ttlMs` after it was set. `now` is a
 * parameter rather than read from the clock internally, so a test can move time without waiting.
 */
export function createTtlCache<V>(ttlMs: number): TtlCache<V> {
	const store = new Map<string, { value: V; expiresAt: number }>();
	return {
		get(key: string, now: number = Date.now()): V | undefined {
			const entry = store.get(key);
			if (!entry || entry.expiresAt <= now) {
				store.delete(key);
				return undefined;
			}
			return entry.value;
		},
		set(key: string, value: V, now: number = Date.now()): void {
			store.set(key, { value, expiresAt: now + ttlMs });
		},
	};
}
