import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

for (const outcome of ['ready', 'error'] as const) {
  test(`pending regional values and charts distinguish loading from absence: ${outcome}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route('**/features/rms_ap/allen.values.f32', async (route) => {
      requests += 1;
      await gate;
      if (outcome === 'error' && requests === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
      else await route.continue();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/?v=4&secondary=summary&selected=-362');
    const distribution = page.locator('.distribution-band__surface');
    const valueStatus = page.locator('.region-statistic-domain');
    await expect(distribution).toContainText('Loading feature distribution…');
    await expect(valueStatus).toContainText('Loading regional values…');
    await expect(page.locator('.secondary-view__summary')).toContainText('Loading feature summary…');
    await expect(page.locator('.analysis-panel__surface')).toContainText('Loading feature comparison…');
    await expect(distribution).not.toContainText('No regional distribution loaded');
    await expect(valueStatus).not.toContainText('no finite regional values');
    await expect(distribution.locator('svg')).toHaveCount(0);
    await expect(page.locator('[data-download-comparison]')).toHaveCount(0);
    await expect(page.locator('.region-order')).toBeDisabled();

    const region = page.locator('.region-row[data-region-id="-362"] .region-row__button');
    await region.focus();
    await region.evaluate((button) => { button.dataset.loadingFocus = 'retained'; });
    release();
    if (outcome === 'error') {
      // The payload stays null; the status transition must bypass value memoization.
      await expect(distribution.locator('.operation-status')).toHaveAttribute('data-state', 'error');
      await expect(distribution).toContainText('Feature distribution unavailable');
      await expect(valueStatus).toContainText('Regional values unavailable');
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('data-loading-focus', 'retained');
      await distribution.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    await expect(distribution.locator('.distribution-chart__global')).toBeAttached();
    await expect(valueStatus).not.toContainText('Loading');
    await expect(valueStatus).not.toContainText('unavailable');
    await expect(page.locator('.region-order')).toBeEnabled();
    await expect(region).toHaveAttribute('data-loading-focus', 'retained');
    if (outcome === 'ready') await expect(region).toBeFocused();
  });
}

test('volume anatomy list does not claim an empty regional-value population', async ({ page }) => {
  await page.goto('/app/?v=4&repr=volume&cursor=25,25,25');
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('data-total', '191');
  await expect(page.locator('.region-statistic-domain')).toContainText('Anatomy only');
  await expect(page.locator('.region-statistic-domain')).not.toContainText('no finite regional values');
});

test('region-name catalog failure retains release data and retries independently', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route('**/atlas/allen-ccf-2017/regions.json*', async (route) => {
    requests += 1;
    if (requests === 1) {
      await gate;
      await route.fulfill({ status: 503, body: 'Unavailable' });
    } else await route.continue();
  });
  await page.goto('/app/?v=4&selected=-362');
  const status = page.locator('.region-search > .operation-status');
  await expect(status).toContainText('Loading region names…');
  await expect(page.locator('.distribution-chart__global')).toBeAttached();
  await expect(page.locator('.region-row[data-region-id="-362"]')).toBeAttached();
  release();
  await expect(status).toContainText('Couldn’t load region names');
  await expect(page.locator('.distribution-chart__global')).toBeAttached();
  await expect(page.locator('.region-statistic-domain')).not.toContainText('unavailable');
  await expect(page.locator('.view-frame')).toHaveCount(3);
  await expect(page.locator('.view-frame[aria-busy="false"]')).toHaveCount(3);
  await status.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(status).toBeHidden();
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  expect(requests).toBe(2);
});

test('selected-region companion retries its failed resource while the global chart stays ready', async ({ page }) => {
  // Extend canonical golden inputs in this route fixture; every changed descriptor
  // retains exact byte/SHA verification and the scientific runtime stays unchanged.
  const manifest = JSON.parse(await readFile('../fixtures/golden-v1/manifest.json', 'utf8'));
  const feature = JSON.parse(await readFile('../fixtures/golden-v1/features/rms_ap/feature.json', 'utf8'));
  const summary = JSON.parse(await readFile('../fixtures/golden-v1/features/rms_ap/volume/summary.json', 'utf8'));
  const resources = new Map<string, Buffer>();
  const integrity = (body: string | Buffer) => ({
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
    codec: { name: 'none', decoded_bytes: Buffer.byteLength(body) },
  });
  summary.regional_distributions = [{
    parcellation_id: 'allen', hemisphere_encoding: 'signed-atlas-ids-negative-left',
    assigned_valid_voxel_count: summary.valid_voxel_count, unassigned_valid_voxel_count: 0,
    binnings: summary.distribution.binnings.map((binning: {
      id: string; global_counts: number[]; global_underflow_count: number; global_overflow_count: number;
    }) => {
      const counts = [binning.global_underflow_count, ...binning.global_counts, binning.global_overflow_count];
      const bytes = Buffer.alloc(4 * counts.length * 4);
      counts.forEach((count, index) => bytes.writeUInt32LE(count, index * 4));
      const path = `regional/${binning.id}.u32`;
      resources.set(path, bytes);
      return { binning_id: binning.id, regional_count_layout: 'underflow-bins-overflow', regional_counts: {
        format: 'raw-binary-array-v1', dtype: 'uint32', endianness: 'little', order: 'C', shape: [4, counts.length],
        resource: { path, media_type: 'application/octet-stream', ...integrity(bytes) },
      } };
    }),
  }];
  const summaryBody = JSON.stringify(summary);
  Object.assign(feature.representations.volume.summary.resource, integrity(summaryBody));
  const featureBody = JSON.stringify(feature);
  Object.assign(manifest.features[0].descriptor.resource, integrity(featureBody));
  const manifestBody = JSON.stringify(manifest);
  await page.route('**/__real-data/catalog.json', async (route) => {
    const catalog = await (await route.fetch()).json();
    Object.assign(catalog.datasets[0].releases[0].manifest, integrity(manifestBody));
    await route.fulfill({ json: catalog });
  });
  await page.route('**/__real-data/**/manifest.json', (route) => route.fulfill({ body: manifestBody, contentType: 'application/json' }));
  await page.route('**/features/rms_ap/feature.json', (route) => route.fulfill({ body: featureBody, contentType: 'application/json' }));
  await page.route('**/features/rms_ap/volume/summary.json', (route) => route.fulfill({ body: summaryBody, contentType: 'application/json' }));
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/features/rms_ap/volume/regional/*.u32', async (route) => {
    requests += 1;
    if (requests === 1) {
      await gate;
      await route.fulfill({ status: 503, body: 'Unavailable' });
    } else {
      const path = new URL(route.request().url()).pathname.split('/volume/')[1]!;
      await route.fulfill({ body: resources.get(path)!, contentType: 'application/octet-stream' });
    }
  });
  await page.goto('/app/?v=4&repr=volume&selected=-362&cursor=25,25,25&scale=linear&dist=full');
  const chart = page.locator('.distribution-chart');
  await expect(chart.locator('.distribution-chart__global')).toHaveAttribute('data-total', '191');
  await expect(chart).toContainText('Loading exact selected-region voxel distributions…');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  release();
  await expect(chart).toContainText('Selected-region voxel distributions unavailable');
  await expect(chart.locator('.distribution-chart__global')).toHaveAttribute('data-total', '191');
  await chart.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(chart.locator('.distribution-chart__region[data-region-id="-362"]')).toHaveAttribute('data-total', '191');
  await expect(chart.getByRole('button', { name: 'Download exact counts' })).toBeVisible();
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  expect(requests).toBe(2);
});
