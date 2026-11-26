import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @gard/api dev',
      url: 'http://127.0.0.1:3101/health/live',
      env: { API_PORT: '3101', API_HOST: '127.0.0.1' },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @gard/web dev',
      url: 'http://127.0.0.1:5174',
      env: { API_PORT: '3101', API_HOST: '127.0.0.1', WEB_PORT: '5174' },
      reuseExistingServer: false,
    },
  ],
});
