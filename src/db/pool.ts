import pg from 'pg';

const { Pool } = pg;
export type { Pool } from 'pg';

/**
 * Creates the bot's Postgres connection pool.
 */
export function createPool(databaseUrl: string): pg.Pool {
	return new Pool({ connectionString: databaseUrl });
}
