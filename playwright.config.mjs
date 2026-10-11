import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: [{
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/studio',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_DEMO_MODE: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_DIST_DIR: '.next-e2e',
    },
  }, {
    command: 'node scripts/serve-ui-fixtures.mjs',
    url: 'http://127.0.0.1:3110',
    reuseExistingServer: false,
    timeout: 30000,
  }],
});
