import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.argv[2] ?? 'http://localhost:5173/';
const outputDir = path.resolve(process.argv[3] ?? '../artifacts/local-full-browser-evidence');
const expectedReleaseList = process.env.EPHYS_ATLAS_EXPECTED_RELEASES;
if (!expectedReleaseList) throw new Error('EPHYS_ATLAS_EXPECTED_RELEASES must come from the validated bundle launcher');
if (!['0', '1'].includes(process.env.EPHYS_ATLAS_EXPECTED_MESH ?? '')) {
  throw new Error('EPHYS_ATLAS_EXPECTED_MESH must come from the validated bundle launcher');
}
const expected = expectedReleaseList.split(',').map((entry) => {
  const separator = entry.indexOf('=');
  if (separator <= 0 || separator === entry.length - 1) {
    throw new Error(`Invalid EPHYS_ATLAS_EXPECTED_RELEASES entry: ${entry}`);
  }
  return [entry.slice(0, separator), entry.slice(separator + 1)];
});
const errors = [];
const expectedMesh = process.env.EPHYS_ATLAS_EXPECTED_MESH === '1';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(new URL(`/?v=4&secondary=${expectedMesh ? 'brain-3d' : 'summary'}`, baseUrl).toString(), { waitUntil: 'domcontentloaded' });

  const catalog = await page.evaluate(async () => await (await fetch('/__real-data/catalog.json')).json());
  const identities = catalog.datasets.flatMap((dataset) => dataset.releases.map((release) => [
    dataset.dataset_id, release.release_id,
  ]));
  if (JSON.stringify(identities) !== JSON.stringify(expected)) {
    throw new Error(`Local full catalog differs: ${JSON.stringify(identities)}`);
  }
  const projectByDataset = new Map(catalog.projects.flatMap((project) => (
    project.dataset_ids.map((datasetId) => [datasetId, project.project_id])
  )));

  const scene = page.locator('[data-scene3d-host="connected"]');
  let uploads = null;
  if (expectedMesh) {
    await scene.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('[data-scene3d-host="connected"]')?.getAttribute('data-scene3d-state') === 'ready');
    uploads = await scene.getAttribute('data-geometry-uploads');
    if (uploads !== '2') throw new Error(`Expected two retained mesh uploads, received ${uploads}`);
  }
  for (const tab of ['Summary', 'Top', 'Swanson', ...(expectedMesh ? ['3-D'] : [])]) {
    if (await page.getByRole('tab', { name: tab, exact: true }).count() !== 1) throw new Error(`Missing ${tab} view`);
  }

  const datasetField = page.locator('[data-context-field="dataset"]');
  const projectField = page.locator('[data-context-field="project"]');
  const visited = [];
  for (const [index, [datasetId, releaseId]] of expected.entries()) {
    if (index > 0) {
      const projectId = projectByDataset.get(datasetId);
      if (!projectId) throw new Error(`Catalog has no project for ${datasetId}`);
      const activeProjectId = new URL(page.url()).searchParams.get('project');
      if (activeProjectId !== projectId) {
        await projectField.locator('.context-menu__trigger').click();
        await projectField.locator(`[data-context-option="project:${projectId}"]`).click();
      }
      await datasetField.locator('.context-menu__trigger').click();
      await datasetField.getByRole('option').filter({ hasText: releaseId }).click();
    }
    await page.waitForFunction((id) => {
      const release = document.querySelector('[data-context-field="dataset"] .context-field__release')?.textContent;
      return release?.includes(`ID · ${id}`);
    }, releaseId);
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
  if (expectedMesh) {
    await page.getByRole('tab', { name: '3-D', exact: true }).click();
    const explode = page.getByRole('slider', { name: 'Explode 3-D brain' });
    await explode.fill('0.35');
    await page.waitForFunction(() => document.querySelector('[data-scene3d-host="connected"]')?.getAttribute('data-explode') === '0.35');
    if (await scene.getAttribute('data-geometry-uploads') !== uploads) throw new Error('Dataset/view changes rebuilt 3-D geometry');
  }

  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, 'full-local-1280x800.png'), fullPage: true });
  const evidence = {
    format: 'full-local-browser-validation-v1',
    url: page.url(),
    catalog: identities,
    visited,
    mesh: expectedMesh ? { state: await scene.getAttribute('data-scene3d-state'), geometry_uploads: uploads } : null,
    views: ['summary', 'top', 'swanson', ...(expectedMesh ? ['brain-3d'] : [])],
    browser_errors: errors,
  };
  await writeFile(path.join(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (errors.length) throw new Error(`Local full browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
}
