import { defineConfig } from '@playwright/test';
import { seenHelpTourStorageState } from './playwright.seen-tour';

export default defineConfig({
  testDir: './test/volume-benchmark',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    storageState: seenHelpTourStorageState('http://127.0.0.1:4173'),
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
