import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outputDir = path.resolve(process.argv[3] ?? '../artifacts/mesh-d042-browser-evidence');
const url = new URL('/?v=4&parcel=beryl&secondary=brain-3d', baseUrl).toString();
const meshRequests = [];
const browserErrors = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('request', (request) => {
    if (request.url().includes('/__local-assets/mesh/')) meshRequests.push(new URL(request.url()).pathname);
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  const started = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const host = page.locator('[data-scene3d-host="connected"]');
  await host.waitFor({ state: 'visible', timeout: 30_000 });
  try {
    await page.waitForFunction(() => document.querySelector('[data-scene3d-host="connected"]')?.getAttribute('data-scene3d-state') === 'ready', null, { timeout: 60_000 });
  } catch (error) {
    const diagnostic = await host.evaluate((element) => ({ ...element.dataset, text: element.parentElement?.textContent }));
    throw new Error(`D042 viewport did not become ready: ${JSON.stringify({ diagnostic, browserErrors })}`, { cause: error });
  }
  const readyMs = performance.now() - started;
  const state = await host.evaluate((element) => ({ ...element.dataset, canvases: element.querySelectorAll('canvas').length }));
  if (state.scene3dState !== 'ready' || state.lod !== 'compiled-full' || state.geometryUploads !== '2' || state.canvases !== 1) {
    throw new Error(`D042 retained viewport state differs: ${JSON.stringify(state)}`);
  }
  const manifestPath = meshRequests.find((requestPath) => requestPath.endsWith('/manifest.json'));
  if (!manifestPath) throw new Error('D042 immutable manifest request was not observed');
  const manifest = await page.evaluate(async (requestPath) => await (await fetch(requestPath, { cache: 'no-store' })).json(), manifestPath);
  if (manifest.default_lod_id !== 'compiled-full' || manifest.upgrade_lod_id !== null
    || manifest.lods?.[0]?.triangle_count !== 989_811 || manifest.regions?.length !== 1_130) {
    throw new Error('D042 browser manifest selection or topology differs');
  }
  const requestsBeforePresentation = meshRequests.length;
  const uploadsBeforePresentation = await host.getAttribute('data-geometry-uploads');
  await page.evaluate(() => {
    const next = new URL(location.href);
    next.searchParams.set('parcel', 'cosmos');
    history.pushState(null, '', next);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => new URL(location.href).searchParams.get('parcel') === 'cosmos');
  await page.waitForTimeout(100);
  if (await host.getAttribute('data-geometry-uploads') !== uploadsBeforePresentation || meshRequests.length !== requestsBeforePresentation) {
    throw new Error('D042 presentation change rebuilt or refetched geometry');
  }
  const canvas = host.locator('canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('D042 canvas has no layout bounds');
  const initialCamera = new URL(page.url()).searchParams.get('camera3d');
  await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .6, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction((before) => new URL(location.href).searchParams.get('camera3d') !== before, initialCamera);
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, 'desktop-1280x800.png'), fullPage: true });
  await page.getByRole('button', { name: 'Maximize secondary panel' }).click();
  await page.screenshot({ path: path.join(outputDir, 'maximized-1280x800.png'), fullPage: true });
  await page.keyboard.press('Escape');
  const requestsBeforeResponsive = meshRequests.length;
  const rendersBeforeResponsive = Number(await host.getAttribute('data-render-count'));
  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await page.locator('[data-secondary-panel="brain-3d"]').waitFor({ state: 'visible' });
  await page.waitForFunction((before) => {
    const element = document.querySelector('[data-scene3d-host="connected"]');
    return element?.getAttribute('data-active') === 'true' && Number(element.getAttribute('data-render-count')) > before;
  }, rendersBeforeResponsive);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outputDir, 'phone-390x760.png'), fullPage: true });
  if (await host.getAttribute('data-geometry-uploads') !== uploadsBeforePresentation || meshRequests.length !== requestsBeforeResponsive) {
    throw new Error('D042 responsive transition rebuilt or refetched geometry');
  }
  const resources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/__local-assets/mesh/'))
    .map((entry) => ({ name: new URL(entry.name).pathname, duration_ms: entry.duration, transfer_bytes: entry.transferSize })));
  const evidence = {
    format: 'd042-local-browser-validation-v1',
    url: page.url(),
    browser: await page.evaluate(() => navigator.userAgent),
    viewport: { width: 1280, height: 800 },
    ready_ms: readyMs,
    mesh_requests: meshRequests,
    resources,
    state,
    manifest: { pack_id: manifest.pack_id, default_lod_id: manifest.default_lod_id, upgrade_lod_id: manifest.upgrade_lod_id, triangle_count: manifest.lods[0].triangle_count, signed_region_count: manifest.regions.length },
    presentation_changed_without_geometry_request_or_upload: true,
    responsive_transition_without_geometry_request_or_upload: true,
    browser_errors: browserErrors,
  };
  await writeFile(path.join(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (browserErrors.length) throw new Error(`D042 browser errors: ${browserErrors.join('; ')}`);
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
}
