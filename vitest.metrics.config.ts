import { defineConfig } from 'vitest/config'

// AI vs AI measurements (`npm run metrics`): slow, prints tables, not part of `npm test`.
export default defineConfig({
  test: {
    include: ['tests/metrics/**/*.metrics.test.ts'],
    environment: 'node',
    testTimeout: 1_200_000,
  },
})
