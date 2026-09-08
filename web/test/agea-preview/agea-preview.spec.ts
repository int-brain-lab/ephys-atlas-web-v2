import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.env.EPHYS_ATLAS_REAL_RELEASE!;
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const first = 'experiment-74658173';
async function choose(page: Page, query: string): Promise<string> {
  const field = page.locator('[data-context-field="feature"]');
  await field.locator('.context-menu__trigger').click();
  await page.getByRole('searchbox', { name: 'Search features…' }).fill(query);
  const option = field.getByRole('option').first();
  const id = (await option.getAttribute('data-context-option'))!;
  await option.click(); return id;
}
async function ready(page: Page, id: string): Promise<void> {
  await expect(page.locator(`[data-volume-feature="${id}"]`)).toHaveCount(3);
}

test('full real catalog loads through one metadata bundle and the existing atlas views', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests: string[] = []; const errors: string[] = [];
  page.on('request', request => { if (request.url().includes('/__real-data/')) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const started = Date.now(); await page.goto('/app/'); await ready(page, first);
  const startupMs = Date.now() - started;
  expect(manifest.features).toHaveLength(4345);
  expect(requests.filter(url => url.endsWith('/metadata-bundle.json.gz'))).toHaveLength(1);
  expect(requests.filter(url => /\/(feature|resource-index|summary)\.json$/.test(url))).toHaveLength(0);
  expect(requests.filter(url => url.endsWith('.f16.gz'))).toHaveLength(1);
  expect(requests.filter(url => url.endsWith('validity.u8.gz'))).toHaveLength(1);
  await expect(page.getByRole('complementary', { name: 'Brain regions' })).toBeVisible();
  const field = page.locator('[data-context-field="feature"]');
  await field.locator('.context-menu__trigger').click();
  await expect.poll(() => field.getByRole('option').count()).toBeLessThan(30);
  await field.getByRole('listbox').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(field.locator(`[data-context-option="${manifest.features.at(-1).id}"]`)).toBeVisible();
  expect(requests.filter(url => url.endsWith('.f16.gz'))).toHaveLength(1);
  await page.getByRole('searchbox', { name: 'Search features…' }).fill('Slc17a7');
  await expect(field.getByRole('option')).toHaveCount(2);
  const id = (await field.getByRole('option').first().getAttribute('data-context-option'))!;
  const switching = Date.now(); await field.getByRole('option').first().click(); await ready(page, id);
  const switchMs = Date.now() - switching;
  expect(new URL(page.url()).searchParams.get('feature')).toBe(id);
  const beforeNavigation = requests.filter(url => url.endsWith('.f16.gz')).length;
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.set('cursor', '1801,-2400,-2798');
    history.replaceState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  });
  for (const [axis, index] of [['coronal', '39'], ['sagittal', '38'], ['horizontal', '16']]) {
    await expect(page.locator(`[data-view="${axis}"] .view-frame__renderer`)).toHaveAttribute('data-volume-index', index!);
  }
  expect(requests.filter(url => url.endsWith('.f16.gz'))).toHaveLength(beforeNavigation);
  await page.screenshot({ path: 'artifacts/agea-preview-desktop.png', fullPage: true, animations: 'disabled' });
  const previous = requests.filter(url => url.endsWith('.f16.gz')).length;
  await page.reload(); await ready(page, id);
  expect(requests.filter(url => url.endsWith('.f16.gz'))).toHaveLength(previous);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-layout', 'phone');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/agea-preview-mobile.png', fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
  await testInfo.attach('local-measurements', { body: JSON.stringify({ startupMs, switchMs,
    metadataEncodedBytes: manifest.metadata_bundle.bytes, metadataDecodedBytes: manifest.metadata_bundle.codec.decoded_bytes,
    source: 'real local preview; timings are not production-origin acceptance', requests }, null, 2), contentType: 'application/json' });
});

test('failed expression selection clears stale volume and remains recoverable', async ({ page }) => {
  await page.goto('/app/'); await ready(page, first);
  await page.route('**/features/experiment-*/volume/chunks/*.f16.gz', route => route.fulfill({ body: Buffer.from('corrupt') }));
  const id = await choose(page, 'Slc17a7');
  await expect(page.locator(`[data-volume-feature="${first}"]`)).toHaveCount(0);
  await expect(page.locator('.projection-viewport__error').first()).toBeVisible();
  await page.unroute('**/features/experiment-*/volume/chunks/*.f16.gz');
  await choose(page, '74658173'); await ready(page, first);
  await choose(page, id.replace('experiment-', '')); await ready(page, id);
});

test('cache quota failures do not prevent real expression browsing', async ({ page }) => {
  await page.addInitScript(() => { Cache.prototype.put = async () => { throw new DOMException('Test quota', 'QuotaExceededError'); }; });
  await page.goto('/app/'); await ready(page, first);
  const id = await choose(page, 'Slc17a7'); await ready(page, id);
});

test('revisiting a recent gene reuses decoded data without another fetch or decompression', async ({ page }) => {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & { ageaDecodeCount: number };
    state.ageaDecodeCount = 0;
    const Original = DecompressionStream;
    globalThis.DecompressionStream = class extends Original {
      constructor(format: CompressionFormat) { super(format); state.ageaDecodeCount++; }
    };
  });
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/__real-data/')) requests.push(request.url()); });
  await page.goto('/app/'); await ready(page, first);
  await page.locator('.region-row').first().evaluate(node => { node.setAttribute('data-retained-test', 'true'); });
  const id = await choose(page, 'Slc17a7'); await ready(page, id);
  await expect(page.locator('.region-row').first()).toHaveAttribute('data-retained-test', 'true');
  const before = await page.evaluate(() => (globalThis as typeof globalThis & { ageaDecodeCount: number }).ageaDecodeCount);
  const scalarRequests = requests.filter(url => /\.(f16|u8)\.gz$/.test(url)).length;
  await choose(page, '74658173'); await ready(page, first);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { ageaDecodeCount: number }).ageaDecodeCount)).toBe(before);
  expect(requests.filter(url => /\.(f16|u8)\.gz$/.test(url))).toHaveLength(scalarRequests);
});
