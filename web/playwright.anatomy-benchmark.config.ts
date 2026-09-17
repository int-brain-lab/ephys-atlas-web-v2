import { defineConfig } from '@playwright/test';
import { seenHelpTourStorageState } from './playwright.seen-tour';

export default defineConfig({
  testDir: './test/anatomy-benchmark',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    storageState: seenHelpTourStorageState('http://127.0.0.1:4174'),
    launchOptions: { args: ['--enable-precise-memory-info'] },
  },
  webServer: {
    command: 'EPHYS_ATLAS_REAL_RELEASE=../fixtures/golden-v1 EPHYS_ATLAS_REAL_FEATURE=rms_ap npm run dev:real -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
