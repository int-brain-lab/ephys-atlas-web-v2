/** Real app captures only. Run against the validated development-bundle-v5 server. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:5173/app/';
const output = new URL('../src/assets/landing/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-rasterization'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const sourceURL = new URL(baseURL);
  sourceURL.search = '?v=4&dataset=ephys_atlas_channels&release=2026_W32-d050-q14-v1&project=ephys-atlas&edition=local-preview&feature=rms_ap.denoised';
  await page.goto(sourceURL.href);
  const catalog = await page.evaluate(async () => (await fetch('/__real-data/catalog.json')).json());
  if (!catalog.datasets.some((dataset) => dataset.dataset_id === 'ephys_atlas_channels')) {
    throw new Error('Landing capture requires the reviewed real development catalog, never golden fixtures.');
  }
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    await page.waitForFunction((name) => document.querySelector(`[aria-label="${name} view"]`)?.getAttribute('data-state') === 'ready', axis);
  }
  await expect(page.locator('.distribution-chart')).toBeVisible();
  await expect(page.getByRole('button', { name: /Share/ })).toBeEnabled();
  await expect(page.locator('body')).not.toContainText('No finite regional values');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const captures = [];
  async function capture(name, options = {}) {
    const bytes = await page.screenshot({ path: new URL(name, output).pathname, type: 'jpeg', quality: 90, ...options });
    captures.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), viewer_url: page.url() });
  }
  await capture('viewer.jpg');
  const slices = await page.getByRole('region', { name: 'Orthogonal brain slices', exact: true }).boundingBox();
  if (!slices) throw new Error('Missing real slice composition');
  await capture('slices.jpg', { clip: slices });
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.getByRole('tab', { name: '3-D', exact: true }).click();
  await page.locator('[data-scene3d-state="ready"][data-lod="native-full"]').waitFor();
  await page.getByRole('button', { name: 'Maximize secondary panel', exact: true }).click();
  await page.getByRole('slider', { name: 'Explode 3-D brain' }).fill('0.2');
  await page.waitForTimeout(1500); // Allow the retained renderer's resize/frame to settle.
  const meshManifest = await page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/__local-assets/mesh/') && entry.name.endsWith('/manifest.json'));
    if (!resource) throw new Error('Real native mesh manifest was not loaded');
    return (await fetch(resource.name)).json();
  });
  if (meshManifest.pack_id !== 'ibl-native-d070-b5f5abc7d0bb3575') throw new Error('Unexpected anatomy authority');
  const host = await page.locator('[data-scene3d-host]').boundingBox();
  if (!host) throw new Error('Missing 3-D viewport');
  // Capture the actual rendered image area, excluding overlaid app controls.
  await capture('anatomy.jpg', { clip: { x: host.x + 100, y: host.y + 90, width: host.width - 200, height: host.height - 170 } });
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('capture.json', output), JSON.stringify({
    description: 'Unretouched Chromium screenshots of the real local app. Not a scientific release or production-default selection.',
    dataset_id: 'ephys_atlas_channels', release_id: '2026_W32-d050-q14-v1', feature_id: 'rms_ap.denoised',
    anatomy_pack_id: meshManifest.pack_id, bundle: 'data/development-bundle-v5.json',
    browser: browser.version(), platform: process.platform, captures,
  }, null, 2) + '\n');
  console.log(JSON.stringify(captures));
} finally {
  await browser.close();
}
