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
    await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.24 mm');
    await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.67 mm');
    await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v1"]')).toHaveAttribute('data-asset-index', '264');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('max', '527');
    await expect(page.getByLabel('coronal slice')).toHaveAttribute('step', '1');
    await expect(page.getByLabel('sagittal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('sagittal slice')).toHaveAttribute('max', '229');
    await expect(page.getByLabel('horizontal slice')).toHaveAttribute('min', '0');
    await expect(page.getByLabel('horizontal slice')).toHaveAttribute('max', '319');

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
  await slider.fill('281');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.63 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('slices')).toBe('281,220,160');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v1"]')).toHaveAttribute('data-asset-index', '281');
});

test('mouse wheel over an SVG steps its scientific slice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.locator('[data-view="coronal"] .view-frame__brain-svg').dispatchEvent('wheel', { deltaY: 100 });
  await expect(page.getByLabel('coronal slice')).toHaveValue('252');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -0.90 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('slices')).toBe('252,220,160');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v1"]')).toHaveAttribute('data-asset-index', '252');
});

test('linked guides project one slice coordinate into both other views', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const slider = page.getByLabel('coronal slice');
  const sagittalGuide = page.locator('[data-view="sagittal"] .slice-guide[data-source-axis="coronal"]');
  const horizontalGuide = page.locator('[data-view="horizontal"] .slice-guide[data-source-axis="coronal"]');

  await slider.fill('0');
  await expect(sagittalGuide).toHaveAttribute('x1', '527');
  await expect(horizontalGuide).toHaveAttribute('y1', '0');

  await slider.fill('527');
  await expect(sagittalGuide).toHaveAttribute('x1', '0');
  await expect(horizontalGuide).toHaveAttribute('y1', '527');
});

test('legacy 10 um URLs migrate to the native registered anatomy grid', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=1&slices=661,551,401');

  await expect(page.getByLabel('coronal slice')).toHaveValue('264');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('220');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('160');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.20 mm');
  await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.24 mm');
  await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.67 mm');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v1"]')).toHaveAttribute('data-asset-index', '264');
});

test('native left-hemisphere anatomy exposes every scientific range endpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=2&slices=0,229,319');

  await expect(page.getByLabel('coronal slice')).toHaveValue('0');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('229');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('319');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="generated-anatomy-v1"]')).toHaveAttribute('data-asset-index', '0');
  await expect(page.locator('[data-view="sagittal"] [data-slice-asset="generated-anatomy-v1"]')).toHaveAttribute('data-asset-index', '229');
  await expect(page.locator('[data-view="horizontal"] [data-slice-asset="generated-anatomy-v1"]')).toHaveAttribute('data-asset-index', '319');
});

test('schema v0.1 regional fixture drives values, coloring, selection and histogram comparison', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');
  await expect(page.locator('.region-row')).toHaveCount(4);
  await expect(page.locator('.region-row').first()).toContainText('R1');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  await expect(page.locator('.regional-comparison__fixture')).toHaveText('Synthetic integration fixture');

  const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await expect(path).toHaveAttribute('style', /fill:/);

  await page.getByRole('button', { name: 'R1, Fixture region 1' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(page.locator('.selected-region')).toContainText('R1');
  await expect(page.locator('.regional-comparison__list')).toContainText('mean: 1 dB rel. V');
  await expect(path).toHaveClass(/is-selected/);
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

test('renderer region selection flows back into shared URL state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');
  const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await path.dispatchEvent('pointerup');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(page.locator('.selected-region')).toContainText('R1');
});

test('region hover is linked across all anatomical projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');

  const source = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await source.dispatchEvent('pointermove');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const highlighted = page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first();
    await expect(highlighted).toHaveClass(/is-highlighted/);
    await expect(highlighted).not.toHaveClass(/is-selected/);
    await expect(highlighted).toHaveCSS('fill', 'rgb(85, 167, 247)');
    await expect(highlighted).toHaveCSS('fill-opacity', '0.62');
  }

  await page.locator('[data-view="coronal"] .view-frame__slice-figure').dispatchEvent('pointerleave');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    await expect(page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first()).not.toHaveClass(/is-highlighted/);
  }
});

test('region-list hover previews the region in all anatomical projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');

  await page.getByRole('button', { name: 'R1, Fixture region 1' }).hover();
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const highlighted = page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first();
    await expect(highlighted).toHaveClass(/is-highlighted/);
    await expect(highlighted).toHaveCSS('fill', 'rgb(85, 167, 247)');
    await expect(highlighted).toHaveCSS('fill-opacity', '0.62');
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
    const target = document.createElement('div');
    target.id = 'generated-anatomy-test';
    document.body.append(target);
    const source = {
      async loadSlice(axis: 'coronal' | 'sagittal' | 'horizontal', sliceIndex: number) {
        return {
          axis, sliceIndex, worldCoordinateUm: 50,
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
    renderer.setInteractionSink({
      hover: () => undefined,
      toggleSelection: (hit) => { target.dataset.hit = hit.regionId; },
      stepSlice: () => undefined,
      moveCursor: () => undefined,
      reportError: () => undefined,
    });
    await renderer.render(target, {
      axis: 'coronal', sliceIndex: 2, slices: { coronal: 2, sagittal: 1, horizontal: 3 },
      cursor: { xUm: 25, yUm: 50, zUm: 75 }, parcellation: 'beryl',
      selectedRegionIds: ['-20'], feature: null,
    });
    renderer.updatePresentation({
      feature: {
        schemaVersion: '0.1', featureId: 'fixture', representation: 'regional', parcellation: 'beryl',
        regionIds: ['-20'], statistics: { mean: [1] },
      },
      regions: [{ id: '-20', atlasId: -20, index: 0, acronym: 'R', name: 'Region', colorHex: '#123456' }],
      selectedRegionIds: ['-20'], hoveredRegionId: '-20',
      coloring: { mode: 'feature', statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'linear' },
    });
    target.querySelector('path[data-beryl-id="20"]')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  const target = page.locator('#generated-anatomy-test');
  await expect(target).toHaveAttribute('data-slice-asset', 'generated-anatomy-v1');
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
  await expect(target.locator('.slice-guide[data-source-axis="sagittal"]')).toHaveAttribute('x1', '1');
  await expect(target.locator('.slice-guide[data-source-axis="horizontal"]')).toHaveAttribute('y1', '2');
});

test('region search filters loaded metadata rather than prototype rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');
  const search = page.getByLabel('Search brain regions');
  await search.fill('fixture region 3');
  await expect(page.locator('.region-row:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.region-row:not([hidden])')).toContainText('R3');
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
