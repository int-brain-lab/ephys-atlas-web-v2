import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('two selected regions show a clickable feature crossplot', async ({ page }) => {
  await page.goto('/app/?v=4&dataset=golden_fixture&release=golden-v1&feature=rms_ap&selected=-362,-382');
  await page.locator('.analysis-panel__toggle').click();
  const point = page.locator('.region-pair__point[data-pair-feature="rms_ap"]');
  await expect(point).toHaveAttribute('data-group', 'ap');
  await expect(point).toHaveClass(/is-current/);
  await expect(page.locator('.region-pair__list li')).toHaveCount(1);
});

test('a parent pair point appears once the delayed region hierarchy loads, without reselecting', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/atlas/allen-ccf-2017/regions.json*', async (route) => {
    await gate;
    await route.continue();
  });
  // CNU (-623) has no release row; it aggregates its fixture children STR and PAL.
  await page.goto('/app/?v=4&dataset=golden_fixture&release=golden-v1&feature=rms_ap&selected=-623,-382');
  await page.locator('.analysis-panel__toggle').click();
  const point = page.locator('.region-pair__point[data-pair-feature="rms_ap"]');
  await expect(page.locator('.region-pair__caption')).toContainText('0 features');
  await expect(point).toHaveCount(0);
  release();
  await expect(point).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('selected')).toBe('-623,-382');
});

test('failed pair feature loads are disclosed and can be retried without reselecting', async ({ page }) => {
  // Route a byte-identical copy of rms_ap as a second feature whose statistics fail once.
  const integrity = (body: string) => ({ bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'), codec: { name: 'none', decoded_bytes: Buffer.byteLength(body) } });
  const manifest = JSON.parse(await readFile('../fixtures/golden-v1/manifest.json', 'utf8'));
  const feature = JSON.parse(await readFile('../fixtures/golden-v1/features/rms_ap/feature.json', 'utf8'));
  const featureBody = JSON.stringify({ ...feature, id: 'rms_ap_copy', label: 'rms_ap copy' });
  manifest.features.push({ id: 'rms_ap_copy', descriptor: { ...manifest.features[0].descriptor,
    resource: { ...manifest.features[0].descriptor.resource, path: 'features/rms_ap_copy/feature.json', ...integrity(featureBody) } } });
  const manifestBody = JSON.stringify(manifest);
  await page.route('**/__real-data/catalog.json', async (route) => {
    const catalog = await (await route.fetch()).json();
    Object.assign(catalog.datasets[0].releases[0].manifest, integrity(manifestBody));
    await route.fulfill({ json: catalog });
  });
  await page.route('**/__real-data/**/manifest.json', (route) => route.fulfill({ body: manifestBody, contentType: 'application/json' }));
  let failures = 0;
  await page.route('**/features/rms_ap_copy/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/feature.json')) return route.fulfill({ body: featureBody, contentType: 'application/json' });
    if (url.includes('allen.statistics.json') && failures++ === 0) return route.fulfill({ status: 503, body: 'Unavailable' });
    return route.fulfill({ response: await route.fetch({ url: url.replace('/rms_ap_copy/', '/rms_ap/') }) });
  });
  await page.goto('/app/?v=4&feature=rms_ap&selected=-362,-382');
  await page.locator('.analysis-panel__toggle').click();
  const status = page.locator('.region-pair__status');
  await expect(status).toContainText('1 of 2 features failed to load');
  await expect(page.locator('.region-pair__point')).toHaveCount(1);
  await status.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.region-pair__point')).toHaveCount(2);
  await expect(status).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('selected')).toBe('-362,-382');
});

test('a parent paired with its own descendant warns about overlapping populations', async ({ page }) => {
  // CNU (-623) contains STR (-477); CNU versus CA1 (-382) does not overlap.
  await page.goto('/app/?v=4&dataset=golden_fixture&release=golden-v1&feature=rms_ap&selected=-623,-477');
  await page.locator('.analysis-panel__toggle').click();
  await expect(page.locator('.region-pair__point')).toHaveCount(1);
  await expect(page.locator('.region-pair__status')).toContainText('Overlapping populations');
  await page.goto('/app/?v=4&dataset=golden_fixture&release=golden-v1&feature=rms_ap&selected=-623,-382');
  await page.locator('.analysis-panel__toggle').click();
  await expect(page.locator('.region-pair__point')).toHaveCount(1);
  await expect(page.locator('.region-pair__status')).toHaveCount(0);
});
