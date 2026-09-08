import { defineConfig } from '../../../web/node_modules/@playwright/test/index.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: 'q5-origin.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60 * 60 * 1000,
  reporter: [['line']],
  use: {
    browserName: 'chromium',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
});
