import { defineConfig } from '@playwright/test';

const release = process.env.EPHYS_ATLAS_CLUSTER_RELEASE
  ?? '../data/releases/ephys_atlas_clusters/sha256-9b5e55215b306f26-d050-d048-q14-v1';

export default defineConfig({
  testDir: './test/cluster-release',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4177',
    headless: true,
  },
  webServer: {
    command: `EPHYS_ATLAS_REAL_RELEASE=${JSON.stringify(release)} EPHYS_ATLAS_REAL_FEATURE=firing_rate npm run dev:real -- --host 127.0.0.1 --port 4177`,
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
  },
});
