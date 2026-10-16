import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		exclude: ['test/integration/**'],
		environment: 'node',
		// Several files share the one test Postgres database and reset its schema; running them in
		// parallel races one file's reset against another file's still-open connection.
		fileParallelism: false,
	},
});
