import { defineConfig } from '@playwright/test';
import { seenHelpTourStorageState } from './playwright.seen-tour';

// Opt-in whole-application benchmark using the current real development bundle.
export default defineConfig({
  testDir: './test/interaction-benchmark', workers: 1, timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:4197', headless: true,
    viewport: { width: 1440, height: 1000 },
    storageState: seenHelpTourStorageState('http://127.0.0.1:4197') },
  webServer: {
    command: 'cd .. && uv run --project builder --extra test --locked python -m tools.development_bundle run --cwd web data/development-bundle-v7.json -- npm run dev:real -- --host 127.0.0.1 --port 4197 --strictPort',
    url: 'http://127.0.0.1:4197', timeout: 180_000, reuseExistingServer: false,
  },
});
