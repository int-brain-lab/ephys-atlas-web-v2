import { expect, test } from '@playwright/test';

test('3-D context lazily loads its injected immutable fixture and persists responsive state', async ({ page }) => {
  const meshRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/__mesh-pack-fixture/')) meshRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=4&explode3d=0.4&camera3d=0,-5,3,0,0,0,0,0,1');
  expect(meshRequests).toEqual([]);

  const tab = page.getByRole('tab', { name: '3-D' });
  const panel = page.locator('[data-secondary-panel="brain-3d"]');
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();
  const host = panel.locator('[data-scene3d-host="connected"]');
  await expect(host).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(host).toHaveAttribute('data-geometry-uploads', '2');
  await expect(host).toHaveAttribute('data-explode', '0.4');
  const explode = page.getByRole('slider', { name: 'Explode 3-D brain' });
  await expect(explode).toHaveValue('0.4');
  await expect(page.locator('.secondary-view__scene3d-control-value')).toHaveText('40%');
  await expect(panel).toContainText('Experimental 3-D context');
  await expect(panel.locator('canvas')).toHaveCount(1);
  expect(meshRequests.map((url) => new URL(url).pathname)).toEqual([
    '/__mesh-pack-fixture/manifest.json',
    '/__mesh-pack-fixture/default.eam3.gz',
  ]);
  expect(new URL(page.url()).searchParams.get('explode3d')).toBe('0.4');
  expect(new URL(page.url()).searchParams.get('camera3d')).toBe('0,-5,3,0,0,0,0,0,1');

  await explode.fill('0.7');
  await expect(host).toHaveAttribute('data-explode', '0.7');
  await expect(page.locator('.secondary-view__scene3d-control-value')).toHaveText('70%');
  expect(new URL(page.url()).searchParams.get('explode3d')).toBe('0.7');

  const initialHistoryLength = await page.evaluate(() => history.length);
  const initialCamera = new URL(page.url()).searchParams.get('camera3d');
  const canvas = host.locator('canvas');
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  await page.mouse.move(canvasBounds!.x + canvasBounds!.width * .4, canvasBounds!.y + canvasBounds!.height * .45);
  await page.mouse.down();
  await page.mouse.move(canvasBounds!.x + canvasBounds!.width * .65, canvasBounds!.y + canvasBounds!.height * .6, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => new URL(page.url()).searchParams.get('camera3d')).not.toBe(initialCamera);
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength);

  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(host).toHaveAttribute('data-active', 'false');
  await tab.click();
  await expect(host).toHaveAttribute('data-active', 'true');

  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(panel).toBeVisible();
  await page.reload();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();

  await page.getByRole('button', { name: 'Maximize secondary panel' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.secondary-view')).toHaveAttribute('data-maximized', 'false');
  await tab.focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();
});

test('3-D shares presentation and selection without rebuilding geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=4&parcel=cosmos&secondary=brain-3d');
  const host = page.locator('[data-scene3d-host="connected"]');
  await expect(host).toHaveAttribute('data-scene3d-state', 'ready');
  const uploads = await host.getAttribute('data-geometry-uploads');
  const updates = Number(await host.getAttribute('data-presentation-updates'));

  await page.getByLabel('Search brain regions').fill('Isocortex');
  const region = page.locator('[data-region-button="-315"]');
  await expect(region).toBeVisible();
  await region.hover();
  await expect.poll(async () => Number(await host.getAttribute('data-presentation-updates'))).toBeGreaterThan(updates);
  await region.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-315');
  await expect(host).toHaveAttribute('data-geometry-uploads', uploads!);

  const canvas = host.locator('canvas');
  await canvas.dblclick();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width * .35, y: box!.height * .5 } });
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBeNull();
  await expect(host).toHaveAttribute('data-geometry-uploads', uploads!);

  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('parcel', 'beryl');
    history.pushState(null, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect.poll(() => new URL(page.url()).searchParams.get('parcel')).toBe('beryl');
  await expect(host).toHaveAttribute('data-geometry-uploads', uploads!);
  for (const y of [.35, .5, .65]) for (const x of [.25, .5, .75]) {
    await canvas.click({ position: { x: box!.width * x, y: box!.height * y } });
  }
  expect(new URL(page.url()).searchParams.get('selected')).toBeNull();
});

test('volume mode keeps integrated 3-D anatomy-only and scene failure isolated', async ({ page }) => {
  await page.goto('/?v=4&feature=rms_ap&repr=volume&secondary=brain-3d');
  const panel = page.locator('[data-secondary-panel="brain-3d"]');
  await expect(panel.locator('[data-scene3d-host="connected"]')).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(panel.locator('.secondary-view__scene3d-notice')).toContainText('anatomy only');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);

  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { AtlasApp } = await import('/src/app.ts');
    const nullRoot = document.createElement('div');
    document.body.append(nullRoot);
    const nullApp = new AtlasApp(nullRoot);
    const nullHost = nullRoot.querySelector('[data-scene3d-host="null"]') !== null
      && nullRoot.querySelector('canvas') === null;
    nullApp.stop();
    nullRoot.remove();
    const root = document.createElement('div');
    document.body.append(root);
    let destroyed = 0;
    const scene3dFactory = {
      create() { throw new Error('synthetic WebGL failure'); },
      setInteractionSink() {},
      destroy() { destroyed += 1; },
    };
    const app = new AtlasApp(root, { scene3dFactory });
    await app.start();
    root.querySelector<HTMLButtonElement>('[data-secondary-tab="brain-3d"]')!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const outcome = {
      notice: root.querySelector<HTMLElement>('.secondary-view__scene3d-notice')?.textContent,
      slices: root.querySelectorAll('[data-view="coronal"], [data-view="sagittal"], [data-view="horizontal"]').length,
      nullHost,
    };
    app.stop();
    root.remove();
    return { ...outcome, destroyed };
  });
  expect(result).toEqual({ notice: 'Experimental 3-D context unavailable.', slices: 3, nullHost: true, destroyed: 1 });
});

for (const resource of ['manifest.json', 'default.eam3.gz']) {
  test(`3-D ${resource} failure stays isolated from the 2-D workspace`, async ({ page }) => {
    await page.route(`**/__mesh-pack-fixture/${resource}`, (route) => route.fulfill({ status: 503, body: 'offline' }));
    await page.goto('/?v=4&secondary=brain-3d');
    const panel = page.locator('[data-secondary-panel="brain-3d"]');
    await expect(panel.locator('[data-scene3d-host="connected"]')).toHaveAttribute('data-scene3d-state', 'error');
    await expect(panel.locator('.secondary-view__scene3d-notice')).toHaveText('Experimental 3-D context unavailable.');
    await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  });
}
