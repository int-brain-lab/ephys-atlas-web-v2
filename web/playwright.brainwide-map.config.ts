import { defineConfig } from '@playwright/test';

const release = process.env.EPHYS_ATLAS_BRAINWIDE_MAP_RELEASE
  ?? '../data/releases/brainwide_map/legacy-v1-1d908bea-d050-linear-full-v1';

export default defineConfig({
  testDir: './test/brainwide-map-release',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    headless: true,
  },
  webServer: {
    command: `EPHYS_ATLAS_REAL_RELEASE=${JSON.stringify(release)} EPHYS_ATLAS_REAL_FEATURE=choice_decoding_significant EPHYS_ATLAS_REAL_PARCELLATION=beryl npm run dev:real -- --host 127.0.0.1 --port 4175`,
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
