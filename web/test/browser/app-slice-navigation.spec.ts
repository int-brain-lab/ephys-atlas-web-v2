import { expect, test } from '@playwright/test';

const reviewViewports = [
  { name: 'wide-desktop', width: 1680, height: 1050, layout: 'wide', body: { x: 8, y: 72, width: 1664, height: 970 } },
  { name: 'compact-desktop', width: 1440, height: 900, layout: 'compact', body: { x: 8, y: 72, width: 1424, height: 820 } },
  { name: 'compact-laptop', width: 1280, height: 800, layout: 'compact', body: { x: 8, y: 72, width: 1264, height: 720 } },
  { name: 'tablet', width: 1024, height: 768, layout: 'narrow', body: { x: 8, y: 136, width: 1008, height: 624 } },
  { name: 'phone', width: 390, height: 844, layout: 'phone', body: { x: 4, y: 168, width: 382, height: 672 } },
] as const;

for (const viewport of reviewViewports) {
  test(`phase 4 anatomical frames: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/app/');

    const app = page.locator('.atlas-app');
    await expect(app).toBeVisible();
    await expect(app).toHaveAttribute('data-layout', viewport.layout);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', viewport.width);
    await expect(page.locator('body')).toHaveJSProperty('scrollHeight', viewport.height);
    const bodyBounds = await page.locator('.app-body').boundingBox();
    expect(bodyBounds).not.toBeNull();
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(bodyBounds![dimension]).toBeCloseTo(viewport.body[dimension], 0);
    }

    await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-view="sagittal"]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-view="horizontal"]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.20 mm');
    await expect(page.locator('[data-context-field="representation"] .context-field__release')).toHaveText('Allen CCFv3 · 10 µm');
    const dataStatus = page.locator('[data-context-field="data"] .context-field__release');
    const dataValue = page.locator('[data-context-field="data"] .context-field__value');
    const statusBounds = (await dataStatus.boundingBox())!;
    const valueBounds = (await dataValue.boundingBox())!;
    expect(statusBounds.y + statusBounds.height).toBeLessThanOrEqual(valueBounds.y);
    const headerBounds = (await page.locator('.app-header').boundingBox())!;
    expect(valueBounds.y + valueBounds.height).toBeLessThanOrEqual(headerBounds.y + headerBounds.height);
    const displayBounds = (await page.locator('.app-header [data-context-field="representation"]').boundingBox())!;
    expect(displayBounds.y + displayBounds.height).toBeLessThanOrEqual(headerBounds.y + headerBounds.height);
    if (viewport.width >= 1100) {
      const dataBounds = (await page.locator('[data-context-field="data"]').boundingBox())!;
      const featureBounds = (await page.locator('[data-context-field="feature"]').boundingBox())!;
      expect(displayBounds.y).toBe(dataBounds.y);
      expect(displayBounds.y).toBe(featureBounds.y);
      expect(displayBounds.x).toBeGreaterThanOrEqual(featureBounds.x + featureBounds.width);
      const representationValue = page.locator('[data-context-field="representation"] .context-field__value');
      expect(await representationValue.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    if (viewport.width >= 1480) {
      const atlasRegistration = page.locator('[data-context-field="representation"] .context-field__release');
      await expect(atlasRegistration).toBeHidden();
      const contextBounds = await Promise.all(
        ['data', 'feature'].map((field) =>
          page.locator(`[data-context-field="${field}"]`).boundingBox(),
        ),
      );
      for (const bounds of contextBounds) {
        expect(bounds).not.toBeNull();
        expect(bounds!.width).toBeGreaterThan(200);
      }
      for (let index = 1; index < contextBounds.length; index += 1) {
        expect(contextBounds[index]!.x).toBeGreaterThanOrEqual(
          contextBounds[index - 1]!.x + contextBounds[index - 1]!.width,
        );
      }
    }
    await expect(page.locator('[data-view="coronal"] .view-frame__status')).toHaveText('');
    await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.24 mm');
    await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.67 mm');
    await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '660');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('max', '164');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('step', '1');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('aria-valuetext', 'AP -1.20 mm');
    await expect(page.getByLabel('sagittal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('sagittal slice')).toHaveAttribute('max', '141');
    await expect(page.getByLabel('horizontal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('horizontal slice')).toHaveAttribute('max', '99');

    if (viewport.width < 1100) {
      await expect(page.locator('[data-view="coronal"]')).toBeVisible();
      await expect(page.locator('[data-view="sagittal"]')).not.toBeVisible();
    } else {
      await expect(page.locator('[data-view="coronal"]')).toBeVisible();
      await expect(page.locator('[data-view="sagittal"]')).toBeVisible();
      await expect(page.locator('[data-view="horizontal"]')).toBeVisible();
    }

    await page.screenshot({ path: `test-results/phase4-${viewport.name}-${viewport.width}x${viewport.height}.png`, fullPage: true });
  });
}

test('slice control updates calibrated coordinate and renderer request', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');

  const slider = page.getByLabel('coronal slice');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');
  await slider.fill('87');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.60 mm');
  await expect(slider).toHaveAttribute('aria-valuetext', 'AP -1.60 mm');
  await expect(page.locator('[data-view="coronal"] .view-frame__footer output')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).toBe('-239,-1600,-3668');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '700');
});

test('mouse wheel over an SVG steps its scientific slice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');

  await page.locator('[data-view="coronal"] .view-frame__brain-svg').dispatchEvent('wheel', { deltaY: 100 });
  await expect(page.getByLabel('coronal slice')).toHaveValue('81');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.12 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).toBe('-239,-1120,-3668');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '652');
});

test('small pixel wheel deltas accumulate sensitively for smooth macOS scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');

  await page.locator('[data-view="coronal"] .view-frame__brain-svg').evaluate((node) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: 8, deltaMode: WheelEvent.DOM_DELTA_PIXEL, cancelable: true }));
  });
  await expect(page.getByLabel('coronal slice')).toHaveValue('80');
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).toBe('-239,-1040,-3668');
});

test('visible anatomy renders before progressive packs and persists the warmup', async ({ page }) => {
  const visible = new Set([
    '/atlas/projections/ibl-static-registered-v1/registered/coronal/10.isvg.gz',
    '/atlas/projections/ibl-static-registered-v1/registered/sagittal/8.isvg.gz',
    '/atlas/projections/ibl-static-registered-v1/registered/horizontal/6.isvg.gz',
  ]);
  const packRequests: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/registered/**/*.isvg.gz', async (route) => {
    const path = new URL(route.request().url()).pathname;
    packRequests.push(path);
    if (!visible.has(path)) await gate;
    await route.continue();
  });
  await page.goto('/app/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  expect(new Set(packRequests.filter((path) => visible.has(path)))).toEqual(visible);
  release();
  await expect.poll(() => new Set(packRequests).size).toBe(52);
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('ibl-ephys-atlas-schema-v1-verified');
    return (await cache.keys()).filter((request) => request.url.includes('/registered/') && request.url.endsWith('.isvg.gz')).length;
  })).toBe(52);
  expect(packRequests).toHaveLength(52);
  packRequests.length = 0;
  await page.reload();
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  await page.waitForLoadState('networkidle');
  expect(packRequests).toEqual([]);
});

test('a wheel burst is coalesced and only updates linked guides in other projections', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  await expect(page.locator('.view-frame[data-state="ready"]')).toHaveCount(3);
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  const svg = page.locator('[data-view="coronal"] .view-frame__brain-svg');
  await page.evaluate(() => {
    const metrics = { sagittal: 0, horizontal: 0 };
    (window as Window & { __unchangedFigureMutations?: typeof metrics }).__unchangedFigureMutations = metrics;
    for (const axis of ['sagittal', 'horizontal'] as const) {
      const figure = document.querySelector(`[data-view="${axis}"] .view-frame__slice-figure`)!;
      new MutationObserver((mutations) => { metrics[axis] += mutations.length; })
        .observe(figure, { childList: true });
    }
  });
  await svg.evaluate((node) => {
    for (let index = 0; index < 5; index += 1) node.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
  });
  await expect(page.getByLabel('coronal slice')).toHaveValue('77');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '620');
  expect(await page.evaluate(() => (
    (window as Window & { __unchangedFigureMutations?: { sagittal: number; horizontal: number } }).__unchangedFigureMutations
  ))).toEqual({ sagittal: 0, horizontal: 0 });
});

test('an existing anatomy slice stays visible while an adjacent pack loads', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let releasePack: () => void = () => {};
  const packGate = new Promise<void>((resolve) => { releasePack = resolve; });
  await page.route('**/registered/coronal/11.isvg.gz', async (route) => {
    await packGate;
    await route.continue();
  });
  await page.goto('/app/');

  const frame = page.locator('[data-view="coronal"]');
  const target = frame.locator('[data-slice-asset="projection-pack-v1"]');
  const coordinate = frame.locator('.view-frame__coordinate');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  const coordinateX = (await coordinate.boundingBox())!.x;
  await page.getByLabel('coronal slice').fill('88');
  await expect(page.getByLabel('coronal slice')).toHaveValue('88');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  await expect(frame).toHaveAttribute('data-state', 'ready');
  await expect(frame.locator('.operation-status[data-variant="centered"]')).toBeHidden();
  await expect(frame.locator('.view-frame__status')).toHaveText('');

  await expect(frame).toHaveAttribute('data-slice-progress', 'true');
  const progress = frame.locator('.operation-status[data-variant="compact"]');
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('Loading slice…');
  await expect(progress).toContainText('Showing the previous slice');
  await expect(progress.locator('.operation-status__spinner')).toBeVisible();
  expect((await coordinate.boundingBox())!.x).toBeCloseTo(coordinateX, 1);

  releasePack();
  await expect(target).toHaveAttribute('data-asset-index', '708');
  await expect(frame).not.toHaveAttribute('data-slice-progress', 'true');
  await expect(frame.locator('.view-frame__status')).toHaveText('');
});

test('fast same-pack slice movement never shows delayed progress', async ({ page }) => {
  await page.goto('/app/');
  const frame = page.locator('[data-view="coronal"]');
  await expect(frame).toHaveAttribute('data-state', 'ready');
  await frame.evaluate((node) => {
    const changes: string[] = [];
    (window as Window & { __sliceProgressChanges?: string[] }).__sliceProgressChanges = changes;
    new MutationObserver(() => changes.push(node.getAttribute('data-slice-progress') ?? 'cleared'))
      .observe(node, { attributes: true, attributeFilter: ['data-slice-progress'] });
  });

  await page.getByLabel('coronal slice').fill('83');
  await expect(frame.locator('[data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '668');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (
    (window as Window & { __sliceProgressChanges?: string[] }).__sliceProgressChanges
  ))).toEqual([]);
});

test('directional SVG warming reports background activity only in the interacted projection', async ({ page }) => {
  let releasePack: () => void = () => {};
  const packGate = new Promise<void>((resolve) => { releasePack = resolve; });
  await page.route('**/registered/coronal/11.isvg.gz', async (route) => {
    await packGate;
    await route.continue();
  });
  await page.goto('/app/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);

  await page.getByLabel('coronal slice').fill('83');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '668');
  const coronalActivity = page.locator('[data-view="coronal"] .projection-viewport__background-activity');
  await expect(coronalActivity).toBeVisible();
  await expect(coronalActivity).toHaveText('Preparing slices');
  await expect(page.locator('[data-view="sagittal"] .projection-viewport__background-activity')).toBeHidden();
  await expect(page.locator('[data-view="horizontal"] .projection-viewport__background-activity')).toBeHidden();

  releasePack();
  await expect(coronalActivity).toBeHidden();
});

test('an unreliable adjacent-pack request clears progress and retains the previous slice', async ({ page }) => {
  let failPack: () => void = () => {};
  const packGate = new Promise<void>((resolve) => { failPack = resolve; });
  await page.route('**/registered/coronal/11.isvg.gz', async (route) => {
    await packGate;
    await route.fulfill({ status: 503, body: 'temporarily unavailable' });
  });
  await page.goto('/app/');

  const frame = page.locator('[data-view="coronal"]');
  const target = frame.locator('[data-slice-asset="projection-pack-v1"]');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  await page.getByLabel('coronal slice').fill('88');
  await expect(frame).toHaveAttribute('data-slice-progress', 'true');
  failPack();
  await expect(frame).toHaveAttribute('aria-busy', 'false');
  await expect(frame).not.toHaveAttribute('data-slice-progress', 'true');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  await expect(frame.locator('.projection-viewport__error')).toContainText('HTTP 503');
});

test('linked guides project one slice coordinate into both other views', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');

  const slider = page.getByLabel('coronal slice');
  const sagittalGuide = page.locator('[data-view="sagittal"] .slice-guide[data-source-axis="coronal"]');
  const horizontalGuide = page.locator('[data-view="horizontal"] .slice-guide[data-source-axis="coronal"]');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');

  await slider.fill('0');
  await expect(sagittalGuide).toHaveAttribute('x1', '1315');
  await expect(horizontalGuide).toHaveAttribute('y1', '4');

  await slider.fill('164');
  await expect(sagittalGuide).toHaveAttribute('x1', '3');
  await expect(horizontalGuide).toHaveAttribute('y1', '1316');
});

test('unsupported historical URLs reset explicitly to the current canonical state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=2&slices=264,220,160&parcel=beryl');

  await expect(page.getByLabel('coronal slice')).toHaveValue('82');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('68');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('50');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.20 mm');
  await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.24 mm');
  await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.67 mm');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '660');
  await expect.poll(() => new URL(page.url()).search).toBe(
    '?v=4&dataset=golden_fixture&release=golden-v1&project=synthetic-development&context=custom',
  );
});

test('native bilateral anatomy exposes every scientific range endpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&cursor=5651,5400,-7658');

  await expect(page.getByLabel('coronal slice')).toHaveValue('0');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('141');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('99');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '4');
  await expect(page.locator('[data-view="sagittal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '1134');
  await expect(page.locator('[data-view="horizontal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '793');
});

test('empty atlas views disclose pending SVG downloads', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/registered/**/*.isvg.gz', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/app/');
  const frame = page.locator('[data-view="coronal"]');
  await expect(frame).toHaveAttribute('aria-busy', 'true');
  await expect(frame.locator('.view-frame__status')).toHaveText('Loading atlas…');
  await expect(frame.locator('.operation-status[data-variant="centered"]')).toBeVisible();
  await expect(frame.locator('.operation-status__title').first()).toContainText('Loading registered anatomy…');
  release();
  await expect(frame).toHaveAttribute('aria-busy', 'false');
  await expect(frame.locator('.view-frame__status')).toHaveText('');
});
