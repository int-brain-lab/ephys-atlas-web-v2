import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const configuredRelease = process.env.EPHYS_ATLAS_REAL_RELEASE;
if (!configuredRelease) {
  throw new Error('EPHYS_ATLAS_REAL_RELEASE must point to a W26 candidate release');
}
const releaseRoot = path.resolve(configuredRelease);
const manifest = JSON.parse(await readFile(path.join(releaseRoot, 'manifest.json'), 'utf8')) as {
  description: string;
  release: { release_id: string };
  features: { id: string; descriptor: { resource: { path: string } } }[];
};
const featureIds = manifest.features.map((feature) => feature.id);

function float16(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

async function expectedRmsApValue(voxel: [number, number, number]): Promise<number> {
  const root = path.join(releaseRoot, 'features', 'rms_ap');
  const index = JSON.parse(await readFile(path.join(root, 'volume/resource-index.json'), 'utf8'));
  const pack = index.packs.find((item: { axis: string; first_slice: number; slice_count: number }) => (
    item.axis === 'i1' && item.first_slice <= voxel[1] && voxel[1] < item.first_slice + item.slice_count
  ));
  const coordinates: Record<string, number> = {
    i0: voxel[0],
    i1: voxel[1] - pack.first_slice,
    i2: voxel[2],
  };
  const [a0, a1, a2] = pack.decoded.storage_axes as [string, string, string];
  const offset = (
    coordinates[a0]! * pack.decoded.shape[1] + coordinates[a1]!
  ) * pack.decoded.shape[2] + coordinates[a2]!;
  const bytes = gunzipSync(await readFile(path.join(root, pack.resource.path)));
  return float16(bytes.readUInt16LE(offset * 2));
}

async function selectFeature(page: import('@playwright/test').Page, featureId: string): Promise<void> {
  await page.evaluate((selected) => {
    const url = new URL(location.href);
    url.searchParams.set('v', '4');
    url.searchParams.set('repr', 'volume');
    url.searchParams.set('feature', selected);
    url.searchParams.set('cursor', '0,0,0');
    history.replaceState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, featureId);
  await expect(page.locator(`[data-volume-feature="${featureId}"]`)).toHaveCount(3);
}

test('serves the candidate with CDN-like immutable and opaque-gzip headers', async ({ request }) => {
  const catalog = await request.get('/__real-data/catalog.json');
  expect(catalog.headers()['access-control-allow-origin']).toBe('*');
  expect(catalog.headers()['cache-control']).toContain('max-age=60');
  const dataset = (await catalog.json()).datasets[0];
  const prefix = `/__real-data/${dataset.dataset_id}/${manifest.release.release_id}/`;
  const feature = JSON.parse(await readFile(
    path.join(releaseRoot, manifest.features[0]!.descriptor.resource.path),
    'utf8',
  ));
  const index = JSON.parse(await readFile(path.join(
    releaseRoot,
    'features',
    manifest.features[0]!.id,
    feature.representations.volume.encoding.resource_index.resource.path,
  ), 'utf8'));
  const resource = index.packs[0].resource.path as string;
  const response = await request.get(`${prefix}features/${manifest.features[0]!.id}/${resource}`);
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(response.headers()['access-control-allow-origin']).toBe('*');
  expect(response.headers()['content-type']).toContain('application/octet-stream');
  expect(response.headers()['content-encoding']).toBeUndefined();
  expect(Number(response.headers()['content-length'])).toBe((await response.body()).byteLength);
});

test('loads all 41 dynamic features with D043-linked indices and cache reuse', async ({ page }) => {
  expect(featureIds).toHaveLength(41);
  expect(manifest.description).toContain('Local non-published transport candidate');
  const packRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/volume/packs/')) packRequests.push(request.url());
  });
  await page.goto(`/?v=4&repr=volume&feature=${featureIds[0]}&cursor=0,0,0`);
  for (const featureId of featureIds) await selectFeature(page, featureId);

  await expect(page.locator('[data-view="coronal"] .view-frame__renderer')).toHaveAttribute('data-volume-index', '108');
  await expect(page.locator('[data-view="sagittal"] .view-frame__renderer')).toHaveAttribute('data-volume-index', '115');
  await expect(page.locator('[data-view="horizontal"] .view-frame__renderer')).toHaveAttribute('data-volume-index', '7');
  await expect(page.locator('.projection-viewport[data-mode="composite"]')).toHaveCount(3);
  const baseline = packRequests.length;
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('cursor', '0,-50,0');
    history.replaceState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('[data-view="coronal"] .view-frame__renderer')).toHaveAttribute('data-volume-index', '109');
  await page.waitForTimeout(100);
  expect(packRequests).toHaveLength(baseline);
});

test('rapid feature switching cancels stale presentation and keeps the latest feature', async ({ page }) => {
  await page.route('**/features/rms_lf/volume/packs/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
  });
  await page.goto('/?v=4&repr=volume&feature=rms_lf&cursor=0,0,0');
  await selectFeature(page, 'polarity');
  await expect(page.locator('[data-volume-feature="polarity"]')).toHaveCount(3);
  await expect(page.locator('[data-volume-feature="rms_lf"]')).toHaveCount(0);
});

test('outside voxels inspect explicitly and corrupt immutable bytes fail integrity', async ({ page }) => {
  await page.goto('/?v=4&repr=volume&feature=rms_ap&cursor=0,0,0');
  await expect(page.locator('[data-volume-feature="rms_ap"]')).toHaveCount(3);
  const frame = page.locator('[data-view="coronal"]');
  await frame.evaluate((node) => {
    const host = node.querySelector<SVGGraphicsElement>('.projection-viewport__scalar-host')!;
    const regional = node.querySelector<SVGSVGElement>('svg.projection-viewport__regional')!;
    const bounds = host.getBoundingClientRect();
    regional.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }));
  });
  await expect(frame.locator('.region-tooltip__value-label')).toHaveText('Value');
  const tooltip = await frame.locator('.region-tooltip').innerText();
  const match = /voxel (\d+),(\d+),(\d+)/.exec(tooltip);
  expect(match).not.toBeNull();
  const voxel = match!.slice(1).map(Number) as [number, number, number];
  const expectedValue = await expectedRmsApValue(voxel);
  await expect(frame.locator('.region-tooltip__value-text')).toHaveText(
    Number(expectedValue.toPrecision(6)).toLocaleString('en-US'),
  );

  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('cursor', '-5739,5400,332');
    history.replaceState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('[data-view="coronal"] .view-frame__renderer')).toHaveAttribute('data-volume-index', '0');
  const inspections = await frame.evaluate((node) => {
    const host = node.querySelector<SVGGraphicsElement>('.projection-viewport__scalar-host')!;
    const regional = node.querySelector<SVGSVGElement>('svg.projection-viewport__regional')!;
    const bounds = host.getBoundingClientRect();
    for (const [x, y] of [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99]]) {
      regional.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: bounds.left + bounds.width * x,
        clientY: bounds.top + bounds.height * y,
      }));
    }
    return true;
  });
  expect(inspections).toBe(true);
  await expect(frame.locator('.region-tooltip')).toContainText('Outside');

  await page.context().clearCookies();
  await page.route('**/features/polarity/volume/packs/**', async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    body[0] = body[0]! ^ 0xff;
    await route.fulfill({ response, body });
  });
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('feature', 'polarity');
    history.replaceState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('.projection-viewport__error').first()).toContainText('SHA-256 mismatch');
});
