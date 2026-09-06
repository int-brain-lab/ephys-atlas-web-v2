import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/agea-lab', timeout: 30_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4190', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4190',
    env: { AGEA_LAB_DIR: '../artifacts/agea-browser-benchmark' },
    url: 'http://127.0.0.1:4190', reuseExistingServer: true,
  },
});
