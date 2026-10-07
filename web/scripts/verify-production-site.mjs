// Read-only verification of a deployed site or an unpublished exact site build
// over the configured production origin. No scientific fixtures or data copies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const origin = process.argv[2] ?? 'https://ephys-atlas.iblcore.org';
const buildDirectory = process.argv[3];
const catalogCandidate = process.argv[4];
const config = JSON.parse(await readFile(new URL('../../data/deployment/initial-site.json', import.meta.url)));
const receipt = buildDirectory ? JSON.parse(await readFile(path.join(buildDirectory, '_site.json'))) : null;
if (receipt) assert.deepEqual(receipt.config, config);
const errors = [];
const visited = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const check = expect.configure({ timeout: 60_000 });
  await page.addInitScript(() => localStorage.setItem('ibl-ephys-atlas:help-tour-seen:v1', 'seen'));
  await page.route('**/*umami*', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  if (receipt) {
    const prefix = `/site/builds/${receipt.build_id}/`;
    await page.route(origin + '/**', async route => {
      const url = new URL(route.request().url());
      const relative = ['/', '/app/', '/app'].includes(url.pathname) ? 'index.html'
        : url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : null;
      if (relative === null) return route.continue();
      const target = path.resolve(buildDirectory, relative);
      assert.ok(target.startsWith(path.resolve(buildDirectory) + path.sep));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.woff2': 'font/woff2' };
      await route.fulfill({ body: await readFile(target), contentType: types[path.extname(target)] });
    });
  }
  if (catalogCandidate) {
    const raw = await readFile(catalogCandidate);
    await page.route(origin + '/catalog.json', route => route.fulfill({ body: raw, contentType: 'application/json' }));
  }
  async function readySlices() {
    for (const axis of ['coronal', 'sagittal', 'horizontal']) {
      await check(page.getByRole('region', { name: `${axis} view`, exact: true })).toHaveAttribute('data-state', 'ready');
    }
  }
  async function settings() {
    if (!await page.getByLabel('Color mapping', { exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Settings' }).click();
    }
  }
  await page.goto(origin + '/');
  await check(page.locator('[data-landing]')).toBeVisible();
  await check(page.locator('.atlas-app')).toHaveCount(0);
  await page.goto(origin + '/app/?v=4&cursor=-5399,4000,-668');
  await readySlices();
  await check(page.getByRole('button', { name: 'Auto-slice', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const [name, id] of [['FRP', '-68'], ['HATA', '-589508447']]) {
    await page.locator('.region-search__input').fill(name);
    const before = new URL(page.url()).searchParams.get('cursor');
    await page.locator(`[data-region-button="${id}"]`).click();
    await check.poll(() => new URL(page.url()).searchParams.get('cursor')).not.toBe(before);
    await readySlices();
    await check(page.locator('.region-auto-slice-status')).toHaveText('');
    // Verify displayed geometry as well as the cursor state.
    for (const axis of ['coronal', 'sagittal', 'horizontal']) {
      await check.poll(() => page.locator(`[data-view="${axis}"]`).evaluate((frame, id) => {
        const lines = [...frame.querySelectorAll('.slice-guide')];
        const vertical = lines.find(line => line.x1.baseVal.value === line.x2.baseVal.value);
        const horizontal = lines.find(line => line.y1.baseVal.value === line.y2.baseVal.value);
        if (!vertical || !horizontal) return false;
        const point = new DOMPoint(vertical.x1.baseVal.value, horizontal.y1.baseVal.value);
        return [...frame.querySelectorAll(`path[data-allen-id="${id}"]`)].some(p => p.isPointInFill(point));
      }, id)).toBe(true);
    }
  }
  await page.getByRole('button', { name: 'Auto-slice', exact: true }).click();
  const fixed = new URL(page.url()).searchParams.get('cursor');
  await page.locator('.region-search__input').fill('FRP');
  await page.locator('[data-region-button="-68"]').click();
  assert.equal(new URL(page.url()).searchParams.get('cursor'), fixed);
  await settings();
  await page.locator('select[aria-label="Distribution axis"]').selectOption('linear');
  const histogram = page.locator('.distribution-chart__global');
  const original = await histogram.getAttribute('d');
  const fills = () => page.locator('[data-view="coronal"] path[data-allen-id]').evaluateAll(items => items.map(i => i.style.fill));
  let previous = await fills();
  for (const mode of ['quantile-uniform', 'quantile-gaussian']) {
    await settings();
    await page.getByLabel('Color mapping', { exact: true }).selectOption(mode);
    await check.poll(fills).not.toEqual(previous);
    assert.equal(await histogram.getAttribute('d'), original);
    previous = await fills();
    await page.goto(page.url());
    await readySlices();
    await settings();
    await check(page.getByLabel('Color mapping', { exact: true })).toHaveValue(mode);
  }
  for (const tab of ['Top', 'Swanson']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await check(page.locator(`[data-secondary-panel="${tab.toLowerCase()}"] path`).first()).toBeVisible();
  }
  const catalog = await page.evaluate(async () => (await (await fetch('/catalog.json')).json()));
  for (const dataset of catalog.datasets) {
    const release = dataset.releases.find(r => r.release_id === dataset.default_release);
    const response = await fetch(new URL(release.manifest.path, origin + '/'));
    assert.ok(response.ok);
    const raw = Buffer.from(await response.arrayBuffer());
    assert.equal(raw.length, release.manifest.bytes);
    assert.equal(createHash('sha256').update(raw).digest('hex'), release.manifest.sha256);
    const manifest = JSON.parse(raw);
    const feature = dataset.dataset_id === config.default_view.dataset_id
      ? config.default_view.feature_id : manifest.features[0].id;
    const representation = ['agea', 'ephys_atlas_volumes'].includes(dataset.dataset_id) ? 'volume' : 'regional';
    const params = new URLSearchParams({ v: '4', dataset: dataset.dataset_id, release: release.release_id, feature, repr: representation });
    await page.goto(origin + '/app/?' + params);
    await readySlices();
    if (representation === 'volume') await check(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
    visited.push(dataset.dataset_id);
    console.log(`Loaded ${dataset.dataset_id}: ${representation}, ${release.release_id}`);
  }
  if (config.mesh) {
    await page.getByRole('tab', { name: '3-D', exact: true }).click();
    await check(page.locator('[data-scene3d-host="connected"]')).toHaveAttribute('data-scene3d-state', 'ready');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode: receipt ? 'unpublished-build' : 'live-production', build: receipt?.build_id,
    checks: ['landing', 'registered-geometry', 'navigation', 'disabled-navigation', 'quantiles', 'URL', 'static-projections', 'datasets', 'mesh'], visited }));
} finally { await browser.close(); }
