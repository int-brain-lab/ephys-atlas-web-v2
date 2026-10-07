import { expect, test } from '@playwright/test';

for (const width of [1280, 768, 390]) {
  test(`3-D shows an accessible loading overlay until its first rendered frame at ${width}px`, async ({ page }) => {
    let releaseManifest!: () => void;
    let releaseGeometry!: () => void;
    const manifestGate = new Promise<void>((resolve) => { releaseManifest = resolve; });
    const geometryGate = new Promise<void>((resolve) => { releaseGeometry = resolve; });
    await page.route('**/__mesh-pack-fixture/manifest.json', async (route) => {
      await manifestGate;
      await route.continue();
    });
    await page.route('**/__mesh-pack-fixture/default.eam3.gz', async (route) => {
      await geometryGate;
      await route.continue();
    });
    try {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/app/?v=4&explode3d=0.4');
      if (width < 1100) await page.getByRole('button', { name: 'Context', exact: true }).click();
      await page.getByRole('tab', { name: '3-D' }).click();
      const panel = page.locator('[data-secondary-panel="brain-3d"]');
      const overlay = panel.locator('.secondary-view__scene3d-overlay');
      const host = panel.locator('[data-scene3d-host="connected"]');
      const slider = page.getByRole('slider', { name: 'Explode 3-D brain' });
      await expect(overlay).toBeVisible();
      await expect(overlay.getByRole('status')).toContainText('Loading 3D brain…');
      await expect(overlay).toContainText('Downloading and preparing the model. This may take a moment.');
      await expect(overlay.locator('.secondary-view__scene3d-spinner')).toBeVisible();
      await expect(host).toHaveAttribute('aria-busy', 'true');
      await expect(slider).toBeDisabled();
      await expect(overlay.getByRole('button', { name: 'Retry' })).toBeHidden();
      const overlayBox = await overlay.boundingBox();
      const titleBox = await overlay.locator('strong').boundingBox();
      expect(Math.abs((titleBox!.x + titleBox!.width / 2) - (overlayBox!.x + overlayBox!.width / 2))).toBeLessThan(2);
      await page.screenshot({ path: `/tmp/ephys-3d-loading-${width}.png` });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await overlay.locator('.secondary-view__scene3d-spinner').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      releaseManifest();
      await expect(host.locator('canvas')).toHaveCount(1);
      await expect(overlay).toBeVisible();
      await expect(slider).toBeDisabled();
      releaseGeometry();
      await expect(host).toHaveAttribute('data-scene3d-state', 'ready');
      await expect.poll(async () => Number(await host.getAttribute('data-render-count'))).toBeGreaterThan(0);
      await expect(overlay).toBeHidden();
      await expect(host).toHaveAttribute('aria-busy', 'false');
      await expect(slider).toBeEnabled();
      await expect(slider).toHaveValue('0.4');
      await page.getByRole('tab', { name: 'Summary' }).click();
      await page.getByRole('tab', { name: '3-D' }).click();
      await expect(overlay).toBeHidden();
      await expect(host).toHaveAttribute('data-geometry-uploads', '1');
    } finally {
      releaseManifest();
      releaseGeometry();
    }
  });
}

test('3-D context lazily loads its injected immutable fixture and persists responsive state', async ({ page }) => {
  const meshRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/__mesh-pack-fixture/')) meshRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&explode3d=0.4&camera3d=0,-5,3,0,0,0,0,0,1');
  expect(meshRequests).toEqual([]);

  const tab = page.getByRole('tab', { name: '3-D' });
  const panel = page.locator('[data-secondary-panel="brain-3d"]');
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();
  const host = panel.locator('[data-scene3d-host="connected"]');
  await expect(host).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(host).toHaveAttribute('data-geometry-uploads', '1');
  await expect(host).toHaveAttribute('data-explode', '0.4');
  const explode = page.getByRole('slider', { name: 'Explode 3-D brain' });
  await expect(explode).toHaveValue('0.4');
  await expect(page.locator('.secondary-view__scene3d-control-value')).toHaveText('40%');
  await expect(panel).toContainText('3-D anatomy');
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
  await page.goto('/app/?v=4&parcel=cosmos&secondary=brain-3d');
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
  const point = { x: box!.width * .35, y: box!.height * .5 };
  await canvas.click({ position: point });
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-315');
  await canvas.click({ position: point, modifiers: ['Control'] });
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBeNull();
  await page.getByRole('button', { name: 'Select multiple', exact: true }).click();
  await canvas.click({ position: point });
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-315');
  await canvas.click({ position: point });
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBeNull();
  await page.getByRole('button', { name: 'Select multiple', exact: true }).click();
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

test('3-D hover preserves the physical side while the regional panel keeps logical identity', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { AtlasApp } = await import('/src/app.ts');
    const { DEFAULT_VIEW_STATE } = await import('/src/domain/defaults.ts');
    const root = document.createElement('div');
    document.body.append(root);
    let sink: any;
    let presentation: any;
    const factory = {
      setInteractionSink(value: any) { sink = value; },
      create() { return {
        setPresentation(value: any) { presentation = value; },
        setViewState() {}, activate() {}, deactivate() {}, destroy() {},
      }; },
      destroy() {},
    };
    const app = new AtlasApp(root, {
      scene3dFactory: factory, catalogUrl: '/__real-data/catalog.json',
      defaultView: { ...DEFAULT_VIEW_STATE, parcellation: 'cosmos' },
    });
    try {
      await app.start();
      root.querySelector<HTMLButtonElement>('[data-secondary-tab="brain-3d"]')!.click();
      const observations = [];
      // Same anatomical region, alternating sides: a logical-ID equality
      // shortcut must not suppress the second physical highlight update.
      for (const regionId of [315, -315, 315]) {
        sink.regionPointer({ type: 'hover', regionId, originalEvent: new PointerEvent('pointermove') });
        observations.push({ highlighted: presentation.highlightedRegionId,
          logicalHovered: root.querySelector('.region-row[data-hovered="true"]')?.getAttribute('data-region-id') });
      }
      sink.regionPointer({ type: 'select', regionId: 315, originalEvent: new PointerEvent('pointerup') });
      const selected = [...presentation.selectedRegionIds];
      const selections = [selected];
      for (const [regionId, modifiers] of [[343, {}], [315, { ctrlKey: true }], [343, { metaKey: true }]] as const) {
        sink.regionPointer({ type: 'select', regionId, originalEvent: new PointerEvent('pointerup', modifiers) });
        selections.push([...presentation.selectedRegionIds]);
      }
      sink.regionPointer({ type: 'leave', regionId: null, originalEvent: new PointerEvent('pointerleave') });
      return { observations, selected, selections, afterLeave: presentation.highlightedRegionId,
        hoveredRowsAfterLeave: root.querySelectorAll('.region-row[data-hovered="true"]').length };
    } finally { app.stop(); root.remove(); }
  });
  expect(result.observations).toEqual([
    { highlighted: 315, logicalHovered: '-315' },
    { highlighted: -315, logicalHovered: '-315' },
    { highlighted: 315, logicalHovered: '-315' },
  ]);
  expect(result.selected).toEqual([-315, 315]);
  expect(result.selections).toEqual([[-315, 315], [-343, 343], [-343, 343, -315, 315], [-315, 315]]);
  expect(result.afterLeave).toBeNull();
  expect(result.hoveredRowsAfterLeave).toBe(0);
});

test('volume mode keeps integrated 3-D anatomy-only and scene failure isolated', async ({ page }) => {
  await page.goto('/app/?v=4&feature=rms_ap&repr=volume&secondary=brain-3d');
  const panel = page.locator('[data-secondary-panel="brain-3d"]');
  await expect(panel.locator('[data-scene3d-host="connected"]')).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(panel.locator('.secondary-view__scene3d-notice')).toContainText('anatomy only');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);

  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();
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
    const app = new AtlasApp(root, { scene3dFactory, catalogUrl: '/__real-data/catalog.json' });
    await app.start();
    root.querySelector<HTMLButtonElement>('[data-secondary-tab="brain-3d"]')!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const outcome = {
      notice: root.querySelector<HTMLElement>('.secondary-view__scene3d-loading-title')?.textContent,
      slices: root.querySelectorAll('[data-view="coronal"], [data-view="sagittal"], [data-view="horizontal"]').length,
      nullHost,
    };
    app.stop();
    root.remove();
    return { ...outcome, destroyed };
  });
  expect(result).toEqual({ notice: 'Couldn’t load the 3D brain', slices: 3, nullHost: true, destroyed: 1 });
});

for (const resource of ['manifest.json', 'default.eam3.gz']) {
  test(`3-D ${resource} failure stays isolated and Retry reloads the model`, async ({ page }) => {
    await page.route(`**/__mesh-pack-fixture/${resource}`, (route) => route.fulfill({ status: 503, body: 'offline' }));
    await page.goto('/app/?v=4&secondary=brain-3d&explode3d=0.4');
    const panel = page.locator('[data-secondary-panel="brain-3d"]');
    await expect(panel.locator('[data-scene3d-host="connected"]')).toHaveAttribute('data-scene3d-state', 'error');
    const overlay = panel.locator('.secondary-view__scene3d-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('status')).toContainText('Couldn’t load the 3D brain');
    await expect(overlay.locator('.secondary-view__scene3d-spinner')).toBeHidden();
    await expect(panel.locator('[data-scene3d-host="connected"]')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('slider', { name: 'Explode 3-D brain' })).toBeDisabled();
    await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Data details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Data details' });
    await expect(details).toContainText('Synthetic test fixture');
    await expect(details).not.toContainText('Data unavailable');
    await page.keyboard.press('Escape');
    await page.unroute(`**/__mesh-pack-fixture/${resource}`);
    await overlay.getByRole('button', { name: 'Retry' }).click();
    await expect(panel.locator('[data-scene3d-host="connected"]')).toHaveAttribute('data-scene3d-state', 'ready');
    await expect(overlay).toBeHidden();
    await expect(page.getByRole('slider', { name: 'Explode 3-D brain' })).toBeEnabled();
    await expect(page.getByRole('slider', { name: 'Explode 3-D brain' })).toHaveValue('0.4');
    await expect(panel.locator('canvas')).toHaveCount(1);
  });
}
