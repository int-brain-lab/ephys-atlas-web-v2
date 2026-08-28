import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.argv[2] ?? 'http://localhost:5173/';
const outputDir = path.resolve(process.argv[3] ?? '../artifacts/local-full-browser-evidence');
const expected = [
  ['ephys_atlas_channels', '2026_W32'],
  ['ephys_atlas_clusters', 'sha256-9b5e55215b306f26-firing-defaults-v1'],
  ['brainwide_map', 'legacy-v1-1d908bea'],
  ['ephys_atlas_volumes', '2026_W26-candidate-depth4'],
];
const errors = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(new URL('/?v=4&secondary=brain-3d', baseUrl).toString(), { waitUntil: 'domcontentloaded' });

  const catalog = await page.evaluate(async () => await (await fetch('/__real-data/catalog.json')).json());
  const identities = catalog.datasets.flatMap((dataset) => dataset.releases.map((release) => [
    dataset.dataset_id, release.release_id,
  ]));
  if (JSON.stringify(identities) !== JSON.stringify(expected)) {
    throw new Error(`Local full catalog differs: ${JSON.stringify(identities)}`);
  }

  const scene = page.locator('[data-scene3d-host="connected"]');
  await scene.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-scene3d-host="connected"]')?.getAttribute('data-scene3d-state') === 'ready');
  const uploads = await scene.getAttribute('data-geometry-uploads');
  if (uploads !== '2') throw new Error(`Expected two retained mesh uploads, received ${uploads}`);
  for (const tab of ['Summary', 'Top', 'Swanson', '3-D']) {
    if (await page.getByRole('tab', { name: tab, exact: true }).count() !== 1) throw new Error(`Missing ${tab} view`);
  }

  const datasetField = page.locator('[data-context-field="dataset"]');
  const visited = [];
  for (const [index, [datasetId, releaseId]] of expected.entries()) {
    if (index > 0) {
      await datasetField.locator('.context-menu__trigger').click();
      await datasetField.getByRole('option').filter({ hasText: releaseId }).click();
    }
    await page.waitForFunction((id) => document.querySelector('[data-context-field="dataset"] .context-field__release')?.textContent === id, releaseId);
    await page.waitForFunction(() => {
      const field = document.querySelector('[data-context-field="feature"]');
      const value = field?.querySelector('.context-field__value')?.textContent?.trim();
      return field?.querySelector('.context-menu__trigger')?.getAttribute('aria-busy') !== 'true'
        && value && value !== 'No feature selected';
    });
    visited.push({
      dataset_id: datasetId,
      release_id: releaseId,
      feature: await page.locator('[data-context-field="feature"] .context-field__value').innerText(),
      representation: await page.locator('[data-context-field="representation"] .context-field__value').innerText(),
    });
  }

  await page.getByRole('tab', { name: 'Top', exact: true }).click();
  await page.locator('[data-secondary-panel="top"] [data-static-source-mode]').waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Swanson', exact: true }).click();
  await page.locator('[data-secondary-panel="swanson"] [data-static-source-mode]').waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: '3-D', exact: true }).click();
  const explode = page.getByRole('slider', { name: 'Explode 3-D brain' });
  await explode.fill('0.35');
  await page.waitForFunction(() => document.querySelector('[data-scene3d-host="connected"]')?.getAttribute('data-explode') === '0.35');
  if (await scene.getAttribute('data-geometry-uploads') !== uploads) throw new Error('Dataset/view changes rebuilt 3-D geometry');

  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, 'full-local-1280x800.png'), fullPage: true });
  const evidence = {
    format: 'full-local-browser-validation-v1',
    url: page.url(),
    catalog: identities,
    visited,
    mesh: { state: await scene.getAttribute('data-scene3d-state'), geometry_uploads: uploads },
    views: ['summary', 'top', 'swanson', 'brain-3d'],
    browser_errors: errors,
  };
  await writeFile(path.join(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (errors.length) throw new Error(`Local full browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
}
