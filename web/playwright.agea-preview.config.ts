import { defineConfig } from '@playwright/test';

if (!process.env.EPHYS_ATLAS_REAL_RELEASE) throw new Error('EPHYS_ATLAS_REAL_RELEASE must point to the AGEA local preview');
export default defineConfig({
  testDir: './test/agea-preview', timeout: 90_000, workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/agea-preview-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4192', headless: true },
  webServer: {
    command: 'npm run dev:real -- --host 127.0.0.1 --port 4192 --strictPort',
    env: { EPHYS_ATLAS_REAL_FEATURE: 'experiment-74658173' },
    url: 'http://127.0.0.1:4192', reuseExistingServer: true,
  },
});
