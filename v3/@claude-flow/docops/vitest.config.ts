import { defineConfig } from 'vitest/config';

// Package-local config, matching sibling packages (security/, claims/) —
// without one, vitest walks up to v3/vitest.config.ts, whose
// `setupFiles: ['./__tests__/setup.ts']` resolves relative to that
// config's own directory when discovered from the v3/ workspace root, but
// against THIS package's cwd when `npm test` runs from inside it,
// throwing "Cannot find module __tests__/setup.ts" (review Important 11,
// review-2026-09-21.md) — this package doesn't have or need that file.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        '__tests__/**',
        'vendor/**',
        'scripts/**',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
