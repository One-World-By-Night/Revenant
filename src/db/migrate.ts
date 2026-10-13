import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * Runs every `.sql` file in `migrationsDir`, in filename order, inside its own transaction, recording
 * each one in `schema_migrations` so a later run skips it. Safe to call more than once.
 */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<string[]> {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`);

	const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

	const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
	const applied = new Set(rows.map((row) => row.filename));

	const newlyApplied: string[] = [];

	for (const file of files) {
		if (applied.has(file)) {
			continue;
		}
		const sql = await readFile(join(migrationsDir, file), 'utf8');
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(sql);
			await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
			await client.query('COMMIT');
			newlyApplied.push(file);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	return newlyApplied;
}
