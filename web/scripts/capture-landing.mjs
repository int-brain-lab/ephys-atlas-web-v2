/** Real app captures only. Run against the validated development-bundle-v5 server. */
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:5173/app/';
const vectorOnly = process.argv.includes('--vector-only');
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
  // Export the rendered regional layers, preserving path bytes, view boxes,
  // presentation colors and slice guides. No scientific geometry is rebuilt.
  const vector = await page.evaluate(() => {
    const namespace = 'http://www.w3.org/2000/svg';
    const composition = document.querySelector('[aria-label="Orthogonal brain slices"]');
    if (!composition) throw new Error('Missing real slice composition');
    const bounds = composition.getBoundingClientRect();
    const root = document.createElementNS(namespace, 'svg');
    root.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    root.setAttribute('width', String(bounds.width));
    root.setAttribute('height', String(bounds.height));
    const title = document.createElementNS(namespace, 'title');
    title.textContent = 'Linked coronal, sagittal and horizontal atlas views';
    root.append(title);
    const background = document.createElementNS(namespace, 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--color-view').trim());
    root.append(background);
    const styles = new Map();
    const planes = [];
    for (const axis of ['coronal', 'sagittal', 'horizontal']) {
      const frame = composition.querySelector(`[data-view="${axis}"]`);
      const source = frame?.querySelector('.projection-viewport__regional');
      if (!source?.querySelector('path')) throw new Error(`Missing ${axis} regional geometry`);
      const rect = source.getBoundingClientRect();
      const clone = source.cloneNode(true);
      const originalElements = [source, ...source.querySelectorAll('*')];
      const clonedElements = [clone, ...clone.querySelectorAll('*')];
      for (let index = 0; index < originalElements.length; index += 1) {
        const original = originalElements[index];
        const copied = clonedElements[index];
        const computed = getComputedStyle(original);
        copied.removeAttribute('class');
        copied.removeAttribute('style');
        for (const property of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'vector-effect', 'visibility', 'display']) {
          const value = computed.getPropertyValue(property);
          if (value) copied.style.setProperty(property, value);
        }
        const declaration = copied.getAttribute('style');
        if (!styles.has(declaration)) styles.set(declaration, `s${styles.size}`);
        copied.removeAttribute('style');
        copied.setAttribute('class', styles.get(declaration));
      }
      clone.setAttribute('x', String(rect.x - bounds.x));
      clone.setAttribute('y', String(rect.y - bounds.y));
      clone.setAttribute('width', String(rect.width));
      clone.setAttribute('height', String(rect.height));
      root.append(clone);
      planes.push({ axis, view_box: source.getAttribute('viewBox'), path_count: source.querySelectorAll('path').length,
        asset_index: frame.querySelector('[data-asset-index]')?.getAttribute('data-asset-index'),
        world_coordinate_um: frame.querySelector('[data-world-coordinate-um]')?.getAttribute('data-world-coordinate-um') });
    }
    const stylesheet = document.createElementNS(namespace, 'style');
    stylesheet.textContent = [...styles].map(([declaration, name]) => `.${name}{${declaration}}`).join('\n');
    root.prepend(stylesheet);
    if (root.querySelector('script, image, foreignObject, use')) throw new Error('Vector capture must remain standalone geometry');
    return { svg: new XMLSerializer().serializeToString(root) + '\n', planes };
  });
  const vectorBytes = Buffer.from(vector.svg);
  await writeFile(new URL('slices.svg', output), vectorBytes);
  captures.push({ path: 'slices.svg', bytes: vectorBytes.length, sha256: createHash('sha256').update(vectorBytes).digest('hex'),
    viewer_url: page.url(), capture_type: 'rendered-regional-svg', planes: vector.planes });
  if (vectorOnly) {
    if (errors.length) throw new Error(errors.join('\n'));
    const metadata = JSON.parse(await readFile(new URL('capture.json', output), 'utf8'));
    metadata.description = 'Real local app screenshots and rendered regional SVG export. Not a scientific release or production-default selection.';
    metadata.captures = [...metadata.captures.filter((capture) => capture.path !== 'slices.svg'), ...captures];
    await writeFile(new URL('capture.json', output), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify(captures));
  } else {
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
      description: 'Real local app screenshots and rendered regional SVG export. Not a scientific release or production-default selection.',
      dataset_id: 'ephys_atlas_channels', release_id: '2026_W32-d050-q14-v1', feature_id: 'rms_ap.denoised',
      anatomy_pack_id: meshManifest.pack_id, bundle: 'data/development-bundle-v5.json',
      browser: browser.version(), platform: process.platform, captures,
    }, null, 2) + '\n');
    console.log(JSON.stringify(captures));
  }
} finally {
  await browser.close();
}
