import { defineConfig } from '@playwright/test';

/** Explicit real-data acceptance; ignored pinned packs must be built first. */
export default defineConfig({
  testDir: './test/real-3d',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4195', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'BROWSER=none npm run dev:3d -- --port 4195',
    url: 'http://127.0.0.1:4195',
    reuseExistingServer: false,
  },
});
