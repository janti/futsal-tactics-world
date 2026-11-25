import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  // Headless Chromium renders WebGL in software; a modest viewport keeps the frame rate usable.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 540 } } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
