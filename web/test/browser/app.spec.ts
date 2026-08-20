import { expect, test } from '@playwright/test';

const reviewViewports = [
  { name: 'wide-desktop', width: 1680, height: 1050, layout: 'wide', body: { x: 8, y: 72, width: 1664, height: 970 } },
  { name: 'compact-desktop', width: 1440, height: 900, layout: 'compact', body: { x: 8, y: 72, width: 1424, height: 820 } },
  { name: 'compact-laptop', width: 1280, height: 800, layout: 'compact', body: { x: 8, y: 72, width: 1264, height: 720 } },
  { name: 'tablet', width: 1024, height: 768, layout: 'narrow', body: { x: 8, y: 72, width: 1008, height: 688 } },
  { name: 'phone', width: 390, height: 844, layout: 'phone', body: { x: 4, y: 60, width: 382, height: 780 } },
] as const;

for (const viewport of reviewViewports) {
  test(`phase 4 anatomical frames: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    const app = page.locator('.atlas-app');
    await expect(app).toHaveAttribute('data-layout', viewport.layout);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', viewport.width);
    await expect(page.locator('body')).toHaveJSProperty('scrollHeight', viewport.height);
    expect(await page.locator('.app-body').boundingBox()).toEqual(viewport.body);

    await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-view="sagittal"]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-view="horizontal"]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.20 mm');
    await expect(page.locator('[data-context-field="representation"] .context-field__release')).toHaveText('Allen CCFv3 · 10 µm');
    await expect(page.locator('[data-view="coronal"] .view-frame__status')).toHaveText('');
    await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.24 mm');
    await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.67 mm');
    await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '660');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('max', '1319');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('step', '1');
    await expect(page.getByLabel('sagittal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('sagittal slice')).toHaveAttribute('max', '1139');
    await expect(page.getByLabel('horizontal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('horizontal slice')).toHaveAttribute('max', '799');

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
  await page.goto('/');

  const slider = page.getByLabel('coronal slice');
  await slider.fill('701');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.61 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('slices')).toBe('701,550,400');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '701');
});

test('mouse wheel over an SVG steps its scientific slice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.locator('[data-view="coronal"] .view-frame__brain-svg').dispatchEvent('wheel', { deltaY: 100 });
  await expect(page.getByLabel('coronal slice')).toHaveValue('658');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.18 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('slices')).toBe('658,550,400');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '658');
});

test('initial anatomy display fetches only the three visible packs', async ({ page }) => {
  const packRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/packs/16/')) packRequests.push(new URL(request.url()).pathname);
  });
  await page.goto('/');
  await expect(page.locator('[data-slice-asset="generated-anatomy-v2"]')).toHaveCount(3);
  await page.waitForTimeout(250);

  expect(new Set(packRequests)).toEqual(new Set([
    '/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/packs/16/coronal/41.json.gz',
    '/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/packs/16/sagittal/34.json.gz',
    '/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/packs/16/horizontal/25.json.gz',
  ]));
});

test('a wheel burst is coalesced and only updates linked guides in other projections', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-slice-asset="generated-anatomy-v2"]')).toHaveCount(3);
  await expect(page.locator('.view-frame[data-state="ready"]')).toHaveCount(3);
  const svg = page.locator('[data-view="coronal"] .view-frame__brain-svg');
  await page.evaluate(() => {
    const metrics = { sagittal: 0, horizontal: 0 };
    (window as Window & { __unchangedFigureMutations?: typeof metrics }).__unchangedFigureMutations = metrics;
    for (const axis of ['sagittal', 'horizontal'] as const) {
      const figure = document.querySelector(`[data-view="${axis}"] .view-frame__slice-figure`)!;
      new MutationObserver((mutations) => { metrics[axis] += mutations.length; })
        .observe(figure, { attributes: true, childList: true, subtree: true });
    }
  });
  await svg.evaluate((node) => {
    for (let index = 0; index < 5; index += 1) node.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
  });
  await expect(page.getByLabel('coronal slice')).toHaveValue('650');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '650');
  expect(await page.evaluate(() => (
    (window as Window & { __unchangedFigureMutations?: { sagittal: number; horizontal: number } }).__unchangedFigureMutations
  ))).toEqual({ sagittal: 4, horizontal: 4 });
});

test('an existing anatomy slice stays visible while an adjacent pack loads', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let releasePack: () => void = () => {};
  const packGate = new Promise<void>((resolve) => { releasePack = resolve; });
  await page.route('**/packs/16/coronal/42.json.gz', async (route) => {
    await packGate;
    await route.continue();
  });
  await page.goto('/');

  const frame = page.locator('[data-view="coronal"]');
  const target = frame.locator('[data-slice-asset="generated-anatomy-v2"]');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  await page.getByLabel('coronal slice').fill('672');
  await expect(page.getByLabel('coronal slice')).toHaveValue('672');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  await expect(frame).toHaveAttribute('data-state', 'ready');
  await expect(frame.locator('.view-frame__status')).toHaveText('Updating');
  await expect(frame.locator('.view-frame__state-message')).toHaveCSS('opacity', '0');

  releasePack();
  await expect(target).toHaveAttribute('data-asset-index', '672');
  await expect(frame.locator('.view-frame__status')).toHaveText('');
});

test('linked guides project one slice coordinate into both other views', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const slider = page.getByLabel('coronal slice');
  const sagittalGuide = page.locator('[data-view="sagittal"] .slice-guide[data-source-axis="coronal"]');
  const horizontalGuide = page.locator('[data-view="horizontal"] .slice-guide[data-source-axis="coronal"]');

  await slider.fill('0');
  await expect(sagittalGuide).toHaveAttribute('x1', '1319');
  await expect(horizontalGuide).toHaveAttribute('y1', '0');

  await slider.fill('1319');
  await expect(sagittalGuide).toHaveAttribute('x1', '0');
  await expect(horizontalGuide).toHaveAttribute('y1', '1319');
});

test('v1 10 um URLs preserve world coordinates on the native registered anatomy grid', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=1&slices=661,551,401');

  await expect(page.getByLabel('coronal slice')).toHaveValue('661');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('551');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('401');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.21 mm');
  await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.23 mm');
  await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.68 mm');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '661');
});

test('v2 25 um URLs migrate through world coordinates to URL v3', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=2&slices=264,220,160');

  await expect(page.getByLabel('coronal slice')).toHaveValue('660');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('550');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('400');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '660');
  await page.getByLabel('coronal slice').fill('660');
  await expect.poll(() => new URL(page.url()).searchParams.get('v')).toBe('3');
});

test('native bilateral anatomy exposes every scientific range endpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=3&slices=0,1139,799');

  await expect(page.getByLabel('coronal slice')).toHaveValue('0');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('1139');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('799');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '0');
  await expect(page.locator('[data-view="sagittal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '1139');
  await expect(page.locator('[data-view="horizontal"] [data-slice-asset="generated-anatomy-v2"]')).toHaveAttribute('data-asset-index', '799');
});

test('schema v0.1 regional fixture drives values, coloring, selection and histogram comparison', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');
  await expect(page.locator('.region-row')).toHaveCount(874);
  await expect(page.locator('.region-row').first()).toContainText('CH');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  await expect(page.locator('.region-pane__selected')).toHaveAttribute('data-empty', 'true');
  await expect(page.locator('.selected-regions__list')).toBeEmpty();
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-empty', 'true');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-expanded', 'false');
  await expect(page.locator('.analysis-panel__surface')).toBeHidden();
  await expect(page.locator('.analysis-panel__title')).toHaveText('Analysis / comparison');
  await expect(page.locator('.analysis-panel__toggle')).toBeDisabled();
  const coronalBeforeSelection = await page.locator('[data-view="coronal"]').boundingBox();

  const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  const rightPath = page.locator('[data-view="coronal"] path[data-allen-id="362"]').first();
  await expect(path).toHaveAttribute('style', /fill:/);
  await expect(rightPath).toHaveCSS('fill', 'rgb(255, 144, 159)');

  await page.getByRole('button', { name: /MD, Mediodorsal nucleus of thalamus/ }).click();
  await expect(page.locator('.region-pane__selected')).toHaveAttribute('data-empty', 'false');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-empty', 'false');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-expanded', 'true');
  await expect(page.locator('.regional-comparison__fixture')).toHaveText('Synthetic integration fixture');
  expect(await page.locator('[data-view="coronal"]').boundingBox()).toEqual(coronalBeforeSelection);
  await page.getByRole('button', { name: 'Collapse analysis and comparison' }).click();
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-expanded', 'false');
  await expect(page.locator('.analysis-panel__surface')).toBeHidden();
  expect(await page.locator('[data-view="coronal"]').boundingBox()).toEqual(coronalBeforeSelection);
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(page.locator('.selected-region')).toContainText('MD');
  await expect(page.locator('.regional-comparison__list')).toContainText('mean: 1 dB rel. V');
  await expect(path).toHaveClass(/is-selected/);
  await expect(rightPath).toHaveClass(/is-selected/);
});

test('Allen anatomy mode shows actual regions and official ontology colors', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Region color mode').selectOption('anatomy');
  await expect.poll(() => new URL(page.url()).searchParams.get('colors')).toBe('anatomy');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');
  await expect(page.getByRole('button', { name: /MD, Mediodorsal nucleus of thalamus/ })).toBeAttached();
  await expect(page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first()).toHaveCSS('fill', 'rgb(255, 144, 159)');
  await expect(page.locator('.region-row__swatch').first()).toBeVisible();
});

test('data and color controls are driven by the loaded release', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Dataset and release')).toHaveValue('ephys_atlas_channels::golden-v0.3');
  await expect(page.getByLabel('Feature', { exact: true })).toHaveValue('rms_ap');
  await expect(page.getByLabel('Representation')).toHaveValue('regional');
  await expect(page.getByLabel('Parcellation')).toHaveValue('allen');
  await expect(page.getByLabel('Parcellation')).toBeDisabled();
  await expect(page.getByLabel('Regional statistic').locator('option')).toHaveCount(5);
  await expect(page.getByLabel('Feature color legend')).toBeVisible();
  await expect(page.locator('.color-legend__unit')).toHaveText('dB rel. V');

  await page.getByLabel('Color range mode').selectOption('fixed');
  await page.getByLabel('Minimum color value').fill('-2');
  await page.getByLabel('Maximum color value').fill('8');
  await page.getByLabel('Maximum color value').blur();
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('-2,8');
  await expect(page.locator('.color-legend__minimum')).toHaveText('-2');
  await expect(page.locator('.color-legend__maximum')).toHaveText('8');

  await page.getByLabel('Color range mode').selectOption('auto');
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBeNull();
});

test('renderer region selection flows back into shared URL state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');
  const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await path.dispatchEvent('pointerup');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(page.locator('.selected-region')).toContainText('MD');
});

test('region hover is linked across all anatomical projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');

  const source = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await expect(source).toHaveAttribute('style', /fill:/);
  const sourceStyle = await source.getAttribute('style');
  await source.dispatchEvent('pointermove');
  await expect(page.locator('.region-row[data-region-id="-362"]')).toHaveAttribute('data-hovered', 'true');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const highlighted = page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first();
    await expect(highlighted).toHaveClass(/is-highlighted/);
    await expect(highlighted).not.toHaveClass(/is-selected/);
    if (axis === 'coronal') await expect(highlighted).toHaveAttribute('style', sourceStyle ?? '');
    await expect(highlighted).toHaveCSS('filter', 'brightness(1.22) saturate(1.12)');
  }

  await page.locator('[data-view="coronal"] .view-frame__slice-figure').dispatchEvent('pointerleave');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    await expect(page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first()).not.toHaveClass(/is-highlighted/);
  }
});

test('region-list hover previews the region in all anatomical projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');

  await page.getByRole('button', { name: /MD, Mediodorsal nucleus of thalamus/ }).hover();
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const highlighted = page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first();
    await expect(highlighted).toHaveClass(/is-highlighted/);
    await expect(highlighted).toHaveCSS('filter', 'brightness(1.22) saturate(1.12)');
  }

  await page.getByLabel('Search brain regions').hover();
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    await expect(page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first()).not.toHaveClass(/is-highlighted/);
  }
});

test('generated anatomy renderer uses direct mapping IDs and affine-derived guides', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.evaluate(async () => {
    const { GeneratedAnatomySliceRenderer } = await import('/src/rendering/generated-anatomy-renderer.ts');
    const axes = ['coronal', 'sagittal', 'horizontal'] as const;
    const targets = new Map(axes.map((axis) => {
      const target = document.createElement('div');
      target.id = axis === 'coronal' ? 'generated-anatomy-test' : `generated-anatomy-test-${axis}`;
      document.body.append(target);
      return [axis, target] as const;
    }));
    const target = targets.get('coronal')!;
    const source = {
      async loadSlice(axis: 'coronal' | 'sagittal' | 'horizontal', sliceIndex: number) {
        return {
          packFormat: 'anatomy-pack-v2' as const, axis, sliceIndex, worldCoordinateUm: 50,
          viewBox: { x: -0.5, y: -0.5, width: 3, height: 2 },
          paths: [
            { atlasIds: { allen: -10, beryl: -20, cosmos: -30 }, d: 'M0 0L1 0L1 1Z' },
            { atlasIds: { allen: 10, beryl: 20, cosmos: 30 }, d: 'M1 0L2 0L2 1Z' },
          ],
        };
      },
      async worldFromSliceIndices() { return { ml: 25, ap: 50, dv: 75 }; },
      async guidesForWorld(axis: 'coronal' | 'sagittal' | 'horizontal') {
        return [
          { sourceAxis: 'sagittal' as const, targetAxis: axis, dimension: 'x' as const, position: 1 },
          { sourceAxis: 'horizontal' as const, targetAxis: axis, dimension: 'y' as const, position: 2 },
        ];
      },
    };
    const renderer = new GeneratedAnatomySliceRenderer(source);
    const presentation = {
      feature: {
        schemaVersion: '0.1' as const, featureId: 'fixture', representation: 'regional' as const, parcellation: 'beryl' as const,
        regionIds: ['-20'], statistics: { mean: [1] },
      },
      regions: [{ id: '-20', atlasId: -20, index: 0, acronym: 'R', name: 'Region', colorHex: '#123456' }],
      selectedRegionIds: ['-20'], hoveredRegionId: null as string | null,
      coloring: { mode: 'feature' as const, statistic: 'mean' as const, colormap: 'viridis', range: { mode: 'auto' as const }, scale: 'linear' as const },
    };
    renderer.setInteractionSink({
      hover: (hit) => renderer.updatePresentation({ ...presentation, hoveredRegionId: hit?.regionId ?? null }),
      toggleSelection: (hit) => { target.dataset.hit = hit.regionId; },
      stepSlice: () => undefined,
      moveCursor: () => undefined,
      reportError: () => undefined,
    });
    await Promise.all(axes.map((axis) => renderer.render(targets.get(axis)!, {
      axis, sliceIndex: axis === 'coronal' ? 2 : axis === 'sagittal' ? 1 : 3,
      slices: { coronal: 2, sagittal: 1, horizontal: 3 },
      cursor: { xUm: 25, yUm: 50, zUm: 75 }, parcellation: 'beryl',
      selectedRegionIds: ['-20'], feature: null,
    })));
    renderer.updatePresentation(presentation);
    target.querySelector('path[data-beryl-id="20"]')?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    target.querySelector('path[data-beryl-id="20"]')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  const target = page.locator('#generated-anatomy-test');
  await expect(target).toHaveAttribute('data-slice-asset', 'generated-anatomy-v2');
  await expect(target).toHaveAttribute('data-world-coordinate-um', '50');
  await expect(target).toHaveAttribute('data-hit', '-20');
  const leftPath = target.locator('path[data-beryl-id="-20"]');
  const rightPath = target.locator('path[data-beryl-id="20"]');
  await expect(leftPath).toHaveAttribute('data-allen-id', '-10');
  await expect(rightPath).toHaveAttribute('data-allen-id', '10');
  await expect(leftPath).toHaveAttribute('style', /fill: rgb\(68, 1, 84\)/);
  await expect(rightPath).toHaveAttribute('style', /fill: rgb\(18, 52, 86\)/);
  for (const path of [leftPath, rightPath]) {
    await expect(path).toHaveClass(/is-selected/);
    await expect(path).toHaveClass(/is-highlighted/);
  }
  for (const axis of ['sagittal', 'horizontal'] as const) {
    const projection = page.locator(`#generated-anatomy-test-${axis}`);
    await expect(projection.locator('path[data-beryl-id="-20"]')).toHaveClass(/is-highlighted/);
    await expect(projection.locator('path[data-beryl-id="20"]')).toHaveClass(/is-highlighted/);
  }
  await expect(target.locator('.slice-guide[data-source-axis="sagittal"]')).toHaveAttribute('x1', '1');
  await expect(target.locator('.slice-guide[data-source-axis="horizontal"]')).toHaveAttribute('y1', '2');
});

test('region search filters loaded metadata rather than prototype rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017 · official colors');
  const search = page.getByLabel('Search brain regions');
  await search.fill('mediodorsal nucleus of thalamus');
  await expect(page.locator('.region-row:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.region-row:not([hidden])')).toContainText('MD');
  await expect(page.locator('.region-row:visible')).toHaveCount(1);
  await expect(page.locator('.region-row[data-region-id="-567"]')).toBeHidden();
});

test('view maximize is reversible with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const frame = page.locator('[data-view="coronal"]');
  await page.getByRole('button', { name: 'Maximize coronal view' }).click();
  await expect(frame).toHaveAttribute('data-maximized', 'true');
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-maximized-view', 'coronal');
  await page.keyboard.press('Escape');
  await expect(frame).toHaveAttribute('data-maximized', 'false');
  await expect(page.locator('.atlas-app')).not.toHaveAttribute('data-maximized-view', /.+/);
});

test('generated anatomy pack failure is an explicit view-frame error state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/packs/16/coronal/*.json.gz', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.goto('/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-view="coronal"] .view-frame__status')).toHaveText('Unavailable');
});

test('drawers still close on Escape and composition changes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  const settings = page.getByRole('complementary', { name: 'Visualization settings' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings).toHaveAttribute('data-open', 'true');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveAttribute('data-open', 'false');
  await page.getByRole('button', { name: 'Regions' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('complementary', { name: 'Brain regions' })).toHaveAttribute('data-open', 'false');
});
