import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/anatomy-benchmark',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    launchOptions: { args: ['--enable-precise-memory-info'] },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
