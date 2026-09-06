import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/agea-benchmark',
  timeout: 180_000,
  workers: 1,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } }],
  use: { baseURL: 'http://127.0.0.1:4178', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});
