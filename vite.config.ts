import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the production build works from any static host sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [react()],
  // Three.js alone is ~600 kB minified; a single chunk is fine for a static game build.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/tactical/**/*.test.ts'],
    environment: 'node',
    // Several tactical tests play minutes of AI vs AI football.
    testTimeout: 20000,
  },
})
