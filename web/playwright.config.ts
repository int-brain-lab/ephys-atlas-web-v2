import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 15_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: {
    command: 'EPHYS_ATLAS_REAL_RELEASE=../fixtures/golden-v1 EPHYS_ATLAS_REAL_FEATURE=rms_ap VITE_BRAIN_MESH_MANIFEST_URL=/__mesh-pack-fixture/manifest.json VITE_BRAIN_MESH_MANIFEST_BYTES=3664 VITE_BRAIN_MESH_MANIFEST_SHA256=782724b36203a2329fae047f81f5cf432e870d719b6db1d5e0ed75b982c022d4 npm run dev:real -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
