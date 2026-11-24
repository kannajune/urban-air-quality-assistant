import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'public/**/*.js'],
      exclude: ['src/lib/types.js'],
      thresholds: { lines: 97, functions: 97, branches: 92, statements: 97 },
    },
  },
});
