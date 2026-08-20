import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const configuredRelease = process.env.EPHYS_ATLAS_REAL_RELEASE;
if (!configuredRelease) {
  throw new Error('EPHYS_ATLAS_REAL_RELEASE must point to an immutable release directory');
}
const releaseRoot = path.resolve(configuredRelease);
const releaseId = path.basename(releaseRoot);

const catalog = {
  schemaVersion: '0.1',
  datasets: [{
    id: 'ephys_atlas_channels',
    title: 'Ephys Atlas channels (real development release)',
    description: 'Local real-source browser acceptance target.',
    defaultRelease: releaseId,
    releases: [{
      id: releaseId,
      label: releaseId,
      manifest: '../real-release/manifest.json',
      immutable: true,
    }],
  }],
};

function contentType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function fulfillRelease(route: Route): Promise<void> {
  const marker = '/real-release/';
  const url = new URL(route.request().url());
  const offset = url.pathname.indexOf(marker);
  if (offset < 0) return route.abort();
  const relative = decodeURIComponent(url.pathname.slice(offset + marker.length));
  const resolved = path.resolve(releaseRoot, relative);
  if (resolved !== releaseRoot && !resolved.startsWith(`${releaseRoot}${path.sep}`)) {
    return route.fulfill({ status: 400, body: 'unsafe release path' });
  }
  try {
    if (!(await stat(resolved)).isFile()) return route.fulfill({ status: 404 });
    return route.fulfill({
      status: 200,
      contentType: contentType(resolved),
      body: await readFile(resolved),
    });
  } catch {
    return route.fulfill({ status: 404 });
  }
}

async function mockDisplayAssets(page: Page): Promise<void> {
  await page.route('https://atlas.internationalbrainlab.org/data/json/regions.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ allen: [] }),
  }));
  await page.route('https://atlas.internationalbrainlab.org/data/json/slices_*.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ 400: '', 550: '', 660: '' }),
  }));
}

test.beforeEach(async ({ page }) => {
  await stat(path.join(releaseRoot, 'manifest.json'));
  await page.route('**/fixtures/catalog.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(catalog),
  }));
  await page.route('**/real-release/**', fulfillRelease);
  await mockDisplayAssets(page);
});

test('loads real float64 alpha values and all launch parcellations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?v=1&release=${encodeURIComponent(releaseId)}&feature=alpha_mean.raw`);

  await expect(page.locator('[data-context-field="dataset"] .context-field__release')).toHaveText(releaseId);
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toHaveText('alpha mean (raw)');
  await expect(page.locator('.region-search__source')).toHaveText('ALLEN regional values');
  await expect(page.locator('.region-row')).toHaveCount(591);
  await expect(page.locator('.region-row[data-missing="false"]')).toHaveCount(591);
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);

  const firstRegion = page.locator('.region-row[data-missing="false"] button').first();
  await firstRegion.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).not.toBeNull();
  await expect(page.locator('.selected-region')).toHaveCount(1);

  await page.goto(`/?v=1&release=${encodeURIComponent(releaseId)}&feature=rms_ap.denoised&parcel=beryl`);
  await expect(page.locator('.region-search__source')).toHaveText('BERYL regional values');
  await expect(page.locator('.region-row')).toHaveCount(289);

  await page.goto(`/?v=1&release=${encodeURIComponent(releaseId)}&feature=rms_ap.denoised&parcel=cosmos`);
  await expect(page.locator('.region-search__source')).toHaveText('COSMOS regional values');
  await expect(page.locator('.region-row')).toHaveCount(13);
});
