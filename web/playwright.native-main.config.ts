import { defineConfig } from '@playwright/test';

/** Opt-in real full-website gate: same validated bundle as just dev, no fixtures. */
export default defineConfig({
  testDir: './test/native-main', workers: 1, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:4196', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'cd .. && uv run --project builder --extra test --locked python -m tools.development_bundle run --cwd web data/development-bundle-v5.json -- npm run dev:real -- --host 127.0.0.1 --port 4196 --strictPort',
    url: 'http://127.0.0.1:4196', timeout: 180_000, reuseExistingServer: false,
  },
});
