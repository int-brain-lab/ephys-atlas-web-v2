import { defineConfig } from '@playwright/test';

const reviewRoot = process.env.EPHYS_ATLAS_MESH_REVIEW_ROOT;
if (!reviewRoot) throw new Error('EPHYS_ATLAS_MESH_REVIEW_ROOT is required');

export default defineConfig({
  testDir: './test/review',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4178', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178/__mesh-review/review/index.html',
    reuseExistingServer: false,
    env: { EPHYS_ATLAS_MESH_REVIEW_ROOT: reviewRoot },
  },
});
