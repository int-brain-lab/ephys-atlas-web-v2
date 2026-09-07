import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/docs-screenshots',
  timeout: 20_000,
  fullyParallel: false,
  workers: 1,
  snapshotPathTemplate: '../docs/assets/generated/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Allow only minute platform rasterization noise; layout or content drift
      // remains far above this 0.05% threshold.
      maxDiffPixelRatio: 0.0005,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  },
  webServer: {
    command: 'EPHYS_ATLAS_REAL_RELEASE=../fixtures/golden-v1 EPHYS_ATLAS_REAL_FEATURE=rms_ap VITE_BRAIN_MESH_MANIFEST_URL=/__mesh-pack-fixture/manifest.json VITE_BRAIN_MESH_MANIFEST_BYTES=3917 VITE_BRAIN_MESH_MANIFEST_SHA256=6076d1604f67b3e711506e0d400adf58db49f5f6077790ca4d96d2557c56737a npm run dev:real -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
