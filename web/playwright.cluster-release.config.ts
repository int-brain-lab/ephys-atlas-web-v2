import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/cluster-release',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4177',
    headless: true,
  },
  webServer: {
    command: 'EPHYS_ATLAS_REAL_RELEASE=../data/releases/ephys_atlas_clusters/sha256-9b5e55215b306f26-hist-axis-v1 EPHYS_ATLAS_REAL_FEATURE=firing_rate npm run dev:real -- --host 127.0.0.1 --port 4177',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
  },
});
