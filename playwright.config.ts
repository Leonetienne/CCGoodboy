import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'https://orteil.dashnet.org/cookieclicker/',
    trace: 'retain-on-failure',
  },
});
