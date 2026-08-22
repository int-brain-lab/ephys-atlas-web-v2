import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
    if (viewport.width >= 1100) {
      const representationValue = page.locator('[data-context-field="representation"] .context-field__value');
      expect(await representationValue.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    if (viewport.width >= 1480) {
      const atlasRegistration = page.locator('[data-context-field="representation"] .context-field__release');
      await expect(atlasRegistration).toBeVisible();
      expect(await atlasRegistration.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const datasetBounds = await page.locator('[data-context-field="dataset"]').boundingBox();
      const featureBounds = await page.locator('[data-context-field="feature"]').boundingBox();
      expect(datasetBounds).not.toBeNull();
      expect(featureBounds).not.toBeNull();
      expect(datasetBounds!.width).toBeGreaterThan(featureBounds!.width);
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
  await page.goto('/');

  const slider = page.getByLabel('coronal slice');
  await slider.fill('87');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.60 mm');
  await expect(slider).toHaveAttribute('aria-valuetext', 'AP -1.60 mm');
  await expect(page.locator('[data-view="coronal"] .view-frame__footer output')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).toBe('-239,-1600,-3668');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '700');
});

test('mouse wheel over an SVG steps its scientific slice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');

  await page.locator('[data-view="coronal"] .view-frame__brain-svg').dispatchEvent('wheel', { deltaY: 100 });
  await expect(page.getByLabel('coronal slice')).toHaveValue('81');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.12 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).toBe('-239,-1120,-3668');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '652');
});

test('small pixel wheel deltas accumulate sensitively for smooth macOS scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');

  await page.locator('[data-view="coronal"] .view-frame__brain-svg').evaluate((node) => {
    for (let index = 0; index < 2; index += 1) {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: 8, deltaMode: WheelEvent.DOM_DELTA_PIXEL, cancelable: true }));
    }
  });
  await expect(page.getByLabel('coronal slice')).toHaveValue('81');
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).toBe('-239,-1120,-3668');
});

test('initial anatomy display fetches only the three visible packs', async ({ page }) => {
  const packRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/registered/') && request.url().endsWith('.isvg.gz')) {
      packRequests.push(new URL(request.url()).pathname);
    }
  });
  await page.goto('/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  await page.waitForTimeout(250);

  expect(new Set(packRequests)).toEqual(new Set([
    '/atlas/projections/synthetic-static-registered-v1/registered/coronal/10.isvg.gz',
    '/atlas/projections/synthetic-static-registered-v1/registered/sagittal/8.isvg.gz',
    '/atlas/projections/synthetic-static-registered-v1/registered/horizontal/6.isvg.gz',
  ]));
});

test('a wheel burst is coalesced and only updates linked guides in other projections', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');

  const frame = page.locator('[data-view="coronal"]');
  const target = frame.locator('[data-slice-asset="projection-pack-v1"]');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  await page.getByLabel('coronal slice').fill('88');
  await expect(page.getByLabel('coronal slice')).toHaveValue('88');
  await expect(target).toHaveAttribute('data-asset-index', '660');
  await expect(frame).toHaveAttribute('data-state', 'ready');
  await expect(frame.locator('.view-frame__status')).toHaveText('');
  await expect(frame.locator('.view-frame__state-message')).toHaveCSS('opacity', '0');

  await expect(frame.locator('.view-frame__status')).toHaveText('Loading slice…');

  releasePack();
  await expect(target).toHaveAttribute('data-asset-index', '708');
  await expect(frame.locator('.view-frame__status')).toHaveText('');
});

test('linked guides project one slice coordinate into both other views', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const slider = page.getByLabel('coronal slice');
  const sagittalGuide = page.locator('[data-view="sagittal"] .slice-guide[data-source-axis="coronal"]');
  const horizontalGuide = page.locator('[data-view="horizontal"] .slice-guide[data-source-axis="coronal"]');

  await slider.fill('0');
  await expect(sagittalGuide).toHaveAttribute('x1', '1315');
  await expect(horizontalGuide).toHaveAttribute('y1', '4');

  await slider.fill('164');
  await expect(sagittalGuide).toHaveAttribute('x1', '3');
  await expect(horizontalGuide).toHaveAttribute('y1', '1316');
});

test('unsupported historical URLs reset explicitly to the current canonical state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=2&slices=264,220,160&parcel=beryl');

  await expect(page.getByLabel('coronal slice')).toHaveValue('82');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('68');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('50');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.20 mm');
  await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.24 mm');
  await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.67 mm');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '660');
  await expect.poll(() => new URL(page.url()).search).toBe('?v=4');
});

test('native bilateral anatomy exposes every scientific range endpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=4&cursor=5651,5400,-7658');

  await expect(page.getByLabel('coronal slice')).toHaveValue('0');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('141');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('99');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '4');
  await expect(page.locator('[data-view="sagittal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '1134');
  await expect(page.locator('[data-view="horizontal"] [data-slice-asset="projection-pack-v1"]')).toHaveAttribute('data-asset-index', '793');
});

test('schema v1 regional fixture drives values, coloring, selection and histogram comparison', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  await expect(page.locator('.region-row')).toHaveCount(874);
  await expect(page.locator('.region-row').first()).toContainText('CH');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  await expect(page.locator('.distribution-chart__meta')).toContainText('Observation distribution · dB rel. V');
  await expect(page.locator('.distribution-chart__axis')).toHaveAttribute(
    'aria-label',
    'Histogram range -0.5 dB rel. V to 3.5 dB rel. V',
  );
  await expect(page.locator('.distribution-chart__axis-min')).toHaveText('-0.5');
  await expect(page.locator('.distribution-chart__axis-unit')).toHaveText('dB rel. V');
  await expect(page.locator('.distribution-chart__axis-max')).toHaveText('3.5');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-mode', 'auto');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-minimum', '-0.25');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-maximum', '3.25');
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('data-total', '11');
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('data-probability-sum', '1');
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('d', / C /);
  await expect(page.locator('.distribution-chart__global')).not.toHaveAttribute('d', /[HV]/);
  await expect(page.locator('.feature-summary__item')).toHaveCount(4);
  await expect(page.locator('.feature-summary')).toContainText('Observations');
  await expect(page.locator('.feature-summary')).toContainText('Mean');
  await expect(page.locator('.region-pane__selected')).toHaveAttribute('data-empty', 'true');
  await expect(page.locator('.selected-regions__list')).toBeEmpty();
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-empty', 'true');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-expanded', 'false');
  await expect(page.locator('.analysis-panel__surface')).toBeHidden();
  await expect(page.locator('.analysis-panel__title')).toHaveText('Compare selected regions');
  await expect(page.locator('.analysis-panel__toggle')).toBeDisabled();
  const coronalBeforeSelection = await page.locator('[data-view="coronal"]').boundingBox();

  const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  const rightPath = page.locator('[data-view="coronal"] path[data-allen-id="362"]').first();
  await expect(path).toHaveAttribute('style', /fill:/);
  await expect(rightPath).toHaveCSS('fill', 'rgb(255, 144, 159)');

  await page.getByRole('button', { name: /MD, Mediodorsal nucleus of thalamus/ }).click();
  await expect(page.locator('.region-pane__selected')).toHaveAttribute('data-empty', 'false');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-empty', 'false');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-expanded', 'false');
  await expect(page.locator('.analysis-panel__surface')).toBeHidden();
  await expect(page.locator('.regional-comparison__fixture')).toHaveText('Synthetic integration fixture');
  expect(await page.locator('[data-view="coronal"]').boundingBox()).toEqual(coronalBeforeSelection);
  const comparisonTrigger = page.getByRole('button', { name: 'Open comparison for 1 selected region' });
  await comparisonTrigger.click();
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-expanded', 'true');
  const comparisonDialog = page.getByRole('dialog', { name: 'Compare selected regions' });
  await expect(comparisonDialog).toBeVisible();
  await expect(comparisonDialog).toHaveAttribute('data-presentation', 'tray');
  await expect(comparisonDialog).toHaveAttribute('aria-modal', 'false');
  await expect(page.locator('.analysis-panel__count')).toHaveText('1');
  await expect(page.locator('.analysis-dialog__count')).toHaveText('1 selected region');
  await expect(page.locator('.analysis-panel__surface')).toBeVisible();
  await comparisonDialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const dialogBounds = await comparisonDialog.boundingBox();
  const workspaceBounds = await page.locator('.workspace').boundingBox();
  const launcherBounds = await page.locator('.analysis-panel__header').boundingBox();
  const surfaceBounds = await page.locator('.analysis-panel__surface').boundingBox();
  const comparisonBounds = await page.locator('.regional-comparison').boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(workspaceBounds).not.toBeNull();
  expect(launcherBounds).not.toBeNull();
  expect(surfaceBounds).not.toBeNull();
  expect(comparisonBounds).not.toBeNull();
  expect(Math.abs(dialogBounds!.x - workspaceBounds!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(dialogBounds!.width - workspaceBounds!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(dialogBounds!.y + dialogBounds!.height - launcherBounds!.y)).toBeLessThanOrEqual(1);
  expect(surfaceBounds!.y + surfaceBounds!.height - comparisonBounds!.y - comparisonBounds!.height).toBeLessThanOrEqual(17);
  const coronalWhileOpen = await page.locator('[data-view="coronal"]').boundingBox();
  expect(coronalWhileOpen).not.toBeNull();
  expect(coronalWhileOpen!.width).toBe(coronalBeforeSelection!.width);
  expect(coronalWhileOpen!.height).toBe(coronalBeforeSelection!.height);
  expect(Math.abs(coronalWhileOpen!.x - coronalBeforeSelection!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(coronalWhileOpen!.y - coronalBeforeSelection!.y)).toBeLessThanOrEqual(1);
  await page.locator('.region-search__input').fill('MD');
  await expect(comparisonDialog).toBeVisible();
  await expect(page.locator('.region-search__count')).toHaveText(/region/);
  await page.locator('.region-search__input').fill('');
  await page.keyboard.press('Escape');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-expanded', 'false');
  await expect(comparisonDialog).toBeHidden();
  await expect(page.locator('.analysis-panel__surface')).toBeHidden();
  await expect(comparisonTrigger).toBeFocused();
  const coronalAfterClose = await page.locator('[data-view="coronal"]').boundingBox();
  expect(coronalAfterClose).not.toBeNull();
  expect(coronalAfterClose!.width).toBe(coronalBeforeSelection!.width);
  expect(coronalAfterClose!.height).toBe(coronalBeforeSelection!.height);
  expect(Math.abs(coronalAfterClose!.x - coronalBeforeSelection!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(coronalAfterClose!.y - coronalBeforeSelection!.y)).toBeLessThanOrEqual(1);
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(page.locator('.selected-region')).toContainText('MD');
  await expect(page.locator('.distribution-chart__region[data-region-id="-362"]')).toHaveAttribute('data-probability-sum', '1');
  await expect(page.locator('.distribution-chart__legend-item[data-region-id="-362"]')).toContainText('MD · n=3');
  const comparisonRow = page.locator('.regional-comparison__table tr[data-region-id="-362"]');
  await expect(comparisonRow).toContainText('MD · Mediodorsal nucleus of thalamus');
  await expect(comparisonRow).toContainText('3');
  await expect(page.locator('.regional-comparison__table thead')).toContainText('Distribution');
  await expect(comparisonRow.locator('.regional-distribution__plot')).toHaveAttribute(
    'aria-label',
    'MD normalized distribution',
  );
  await expect(comparisonRow.locator('[data-statistic="mean"]')).toHaveText('1');
  await expect(page.locator('.regional-comparison__statistics')).toContainText('Feature values are shown in dB rel. V.');
  await expect(page.locator('.regional-distribution[data-region-id="-362"]')).toContainText('MD');
  await expect(page.locator('.regional-distribution__region')).toHaveAttribute('data-probability-sum', '1');
  await expect(page.locator('.regional-distribution__region')).toHaveAttribute('d', / C /);
  const globalComparisonRow = page.locator('.regional-comparison__table tr[data-series="global"]');
  await expect(globalComparisonRow).toContainText('Global population');
  await expect(globalComparisonRow.locator('.regional-distribution__population')).toHaveAttribute('data-probability-sum', '1');
  await expect(page.locator('.regional-comparison__table tfoot .regional-distribution__axis')).toContainText('dB rel. V');
  await comparisonTrigger.click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download comparison' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ephys_atlas_channels-golden-v1-rms_ap-allen-selected-comparison.csv');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const comparisonCsv = await readFile(downloadPath!, 'utf8');
  expect(comparisonCsv).toContain('dataset_id,release_id,feature_id,representation,parcellation,selected_statistic,unit,population,region_id');
  expect(comparisonCsv).toContain('ephys_atlas_channels,golden-v1,rms_ap,regional,allen,mean,dB rel. V');
  expect(comparisonCsv.trim().split('\n')).toHaveLength(9);
  expect(comparisonCsv).toContain(',-362,MD,Mediodorsal nucleus of thalamus (left),');
  await page.getByRole('button', { name: 'Minimize selected-region comparison' }).click();
  await expect(comparisonDialog).toBeHidden();
  await expect(path).toHaveClass(/is-selected/);
  await expect(rightPath).toHaveClass(/is-selected/);
});

test('selected-region comparison becomes a dismissible phone bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v=4&selected=-362');

  await page.getByRole('button', { name: 'Open comparison for 1 selected region' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare selected regions' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-presentation', 'modal-sheet');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBe(0);
  expect(bounds!.width).toBe(390);
  expect(Math.abs(bounds!.y + bounds!.height - 844)).toBeLessThanOrEqual(1);

  await page.mouse.click(10, 10);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open comparison for 1 selected region' })).toBeFocused();
});

test('Allen anatomy mode shows actual regions and dark-theme ontology colors', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Region color mode').selectOption('anatomy');
  await expect.poll(() => new URL(page.url()).searchParams.get('colors')).toBe('anatomy');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  await expect(page.getByRole('button', { name: /MD, Mediodorsal nucleus of thalamus/ })).toBeAttached();
  await expect(page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first()).toHaveCSS('fill', 'rgb(255, 144, 159)');
  await expect(page.locator('[data-view="coronal"] path[data-allen-id="-1009"]').first()).toHaveCSS('fill', 'rgb(97, 111, 121)');
  await expect(page.locator('.region-row__swatch').first()).toBeVisible();
});

test('long feature menus scroll without option descriptions overlapping', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  const list = feature.locator('.context-menu__list');
  await list.evaluate((node) => {
    const template = node.querySelector<HTMLButtonElement>('.context-menu__option');
    if (!template) throw new Error('Expected a feature option');
    for (let index = 1; index < 30; index += 1) {
      const clone = template.cloneNode(true) as HTMLButtonElement;
      clone.dataset.contextOption = `synthetic-layout-feature-${index}`;
      node.append(clone);
    }
  });

  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await feature.locator('.context-menu__option').evaluateAll((options) => options.every((option) => {
    const copy = option.querySelector<HTMLElement>('.context-menu__option-copy');
    if (!copy) return false;
    const optionBounds = option.getBoundingClientRect();
    const copyBounds = copy.getBoundingClientRect();
    return copyBounds.top >= optionBounds.top && copyBounds.bottom <= optionBounds.bottom;
  }))).toBe(true);
});

test('scientific context menus and color controls are driven by the loaded release', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const dataset = page.locator('[data-context-field="dataset"]');
  const datasetTrigger = dataset.locator('.context-menu__trigger');
  await expect(datasetTrigger).toHaveAttribute('aria-expanded', 'false');
  const headerBounds = await page.locator('.app-header').boundingBox();
  const triggerBounds = await datasetTrigger.boundingBox();
  expect(headerBounds).not.toBeNull();
  expect(triggerBounds).not.toBeNull();
  expect(triggerBounds!.y).toBeLessThanOrEqual(headerBounds!.y + 2);
  expect(triggerBounds!.y + triggerBounds!.height).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height - 2);
  await datasetTrigger.click({ position: { x: triggerBounds!.width / 2, y: 2 } });
  await expect(dataset.locator('.context-menu__panel')).toHaveAttribute('data-open', 'true');
  await expect(dataset.getByRole('option', { selected: true })).toContainText('golden-v1');
  await page.keyboard.press('Escape');
  await expect(datasetTrigger).toBeFocused();

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  const featureSearch = feature.getByLabel('Search features…');
  await expect(featureSearch).toBeFocused();
  await featureSearch.fill('rms_ap');
  await expect(feature.getByRole('option')).toHaveCount(1);
  await expect(feature.getByRole('option', { selected: true })).toContainText('AP RMS (golden fixture)');
  await expect(feature.getByRole('option', { selected: true })).toContainText('dB rel. V');
  await expect(feature.getByRole('option', { selected: true })).toContainText(
    'Synthetic feature exercising regional values, descriptive statistics, histogram, volume chunks and download metadata.',
  );
  await featureSearch.fill('download metadata');
  await expect(feature.getByRole('option')).toHaveCount(1);
  await featureSearch.fill('does not exist');
  await expect(feature.locator('.context-menu__list')).toHaveAttribute('data-empty', 'true');
  await page.keyboard.press('Escape');

  const featureSummary = page.locator('.secondary-view');
  await expect(featureSummary.locator('.feature-summary__description')).toHaveText(
    'Synthetic feature exercising regional values, descriptive statistics, histogram, volume chunks and download metadata.',
  );
  await expect(featureSummary.locator('.feature-summary')).toContainText('Observations');

  const representation = page.locator('[data-context-field="representation"]');
  await representation.locator('.context-menu__trigger').click();
  await expect(representation.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
  await expect(representation.locator('[data-context-group="Representation"]')).toBeVisible();
  await expect(representation.locator('[data-context-group="Parcellation"]')).toBeVisible();
  await expect(representation.getByRole('option', { selected: true })).toHaveCount(2);
  await expect(representation.getByRole('option', { name: /Regional/ })).toHaveAttribute('aria-selected', 'true');
  await expect(representation.getByRole('option', { name: /Allen/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('complementary', { name: 'Visualization settings' });
  await expect(settings).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(settings.getByRole('heading', { name: 'Data' })).toHaveCount(0);
  await expect(page.getByLabel('Regional statistic').locator('option')).toHaveCount(4);
  await expect(page.getByLabel('Regional statistic').locator('option', { hasText: 'Count' })).toHaveCount(0);
  await expect(page.getByLabel('Feature colormap').locator('option')).toHaveText(['Viridis', 'Cividis', 'Magma']);
  await expect(page.getByLabel('Feature color legend')).toBeVisible();
  await expect(page.locator('.color-legend__unit')).toHaveText('dB rel. V');
  await expect(page.locator('.color-range__histogram-bin')).toHaveCount(8);
  await expect(page.getByRole('slider', { name: 'Minimum color value', exact: true })).toHaveValue('-0.25');
  await expect(page.getByRole('slider', { name: 'Maximum color value', exact: true })).toHaveValue('3.25');
  await expect(page.locator('.color-legend__minimum')).toHaveText('-0.250');
  await expect(page.locator('.color-legend__maximum')).toHaveText('3.25');
  await expect(page.locator('.color-legend__domain-minimum')).toHaveText('-0.500');
  await expect(page.locator('.color-legend__domain-maximum')).toHaveText('3.50');
  await expect(page.locator('.color-legend__minimum')).toHaveAttribute('data-side', 'right');
  await expect(page.locator('.color-legend__maximum')).toHaveAttribute('data-side', 'left');
  const activeLabelBounds = await page.locator('.color-range__value').evaluateAll((labels) => labels.map((label) => {
    const bounds = label.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, bottom: bounds.bottom };
  }));
  expect(activeLabelBounds[0]!.right).toBeLessThan(activeLabelBounds[1]!.left);
  await expect(settings.getByRole('spinbutton')).toHaveCount(0);

  const rangeBar = page.locator('.color-legend__bar');
  const minimumBounds = await rangeBar.boundingBox();
  expect(minimumBounds).not.toBeNull();
  expect(activeLabelBounds[0]!.bottom).toBeLessThanOrEqual(minimumBounds!.y);
  await page.mouse.move(
    minimumBounds!.x + minimumBounds!.width * .0625,
    minimumBounds!.y + minimumBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    minimumBounds!.x + minimumBounds!.width * .25,
    minimumBounds!.y + minimumBounds!.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(page.getByLabel('Color range mode')).toHaveValue('fixed');
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).not.toBeNull();
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-mode', 'fixed');
  await expect.poll(async () => Number(
    await page.locator('.distribution-chart__color-range').getAttribute('data-minimum'),
  )).toBeCloseTo(Number(await page.getByRole('slider', { name: 'Minimum color value', exact: true }).inputValue()), 10);
  await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  await expect(rangeBar).toHaveCSS('background-image', 'none');
  await expect(page.locator('.color-range__selection')).toHaveCSS('background-image', /linear-gradient/);

  await page.getByLabel('Feature colormap').selectOption('cividis');
  await expect.poll(() => new URL(page.url()).searchParams.get('cmap')).toBe('cividis');
  await expect(page.locator('.color-legend__bar')).toHaveAttribute('data-colormap', 'cividis');
  await expect(page.locator('.color-range__selection')).toHaveCSS('background-image', /rgb\(0, 34, 78\)/);

  const rangeBeforeWindowDrag = new URL(page.url()).searchParams.get('range')!.split(',').map(Number);
  const selectionBounds = await page.locator('.color-range__selection').boundingBox();
  expect(selectionBounds).not.toBeNull();
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2,
    selectionBounds!.y + selectionBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2 + minimumBounds!.width * .05,
    selectionBounds!.y + selectionBounds!.height / 2,
    { steps: 3 },
  );
  await page.mouse.up();
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).not.toBe(rangeBeforeWindowDrag.join(','));
  const rangeAfterWindowDrag = new URL(page.url()).searchParams.get('range')!.split(',').map(Number);
  expect(rangeAfterWindowDrag[1]! - rangeAfterWindowDrag[0]!).toBeCloseTo(
    rangeBeforeWindowDrag[1]! - rangeBeforeWindowDrag[0]!,
    10,
  );

  await page.getByRole('button', { name: 'Enter exact minimum color value' }).click();
  const exactMinimum = page.getByRole('spinbutton', { name: 'Exact minimum color value', exact: true });
  await expect(exactMinimum).toBeFocused();
  await exactMinimum.fill('-2');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Enter exact maximum color value' }).click();
  await page.getByRole('spinbutton', { name: 'Exact maximum color value', exact: true }).fill('8');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('-2,8');
  await expect(page.locator('.color-legend__minimum')).toHaveText('-2.00');
  await expect(page.locator('.color-legend__maximum')).toHaveText('8.00');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-minimum', '-2');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-maximum', '8');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBeNull();
  await expect(page.getByLabel('Color range mode')).toHaveValue('auto');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-mode', 'auto');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-minimum', '-0.25');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-maximum', '3.25');

  await page.getByRole('slider', { name: 'Maximum color value', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Color range mode')).toHaveValue('fixed');
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).not.toBeNull();
});

test('scientific context picker becomes a bounded phone sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  const panel = feature.locator('.context-menu__panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('position', 'fixed');
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeGreaterThan(0);
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect.poll(async () => {
    const settled = await panel.boundingBox();
    return settled ? settled.y + settled.height : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(844);

  await page.getByRole('button', { name: 'Coronal', exact: true }).click();
  await expect(feature.locator('.context-menu__trigger')).toHaveAttribute('aria-expanded', 'false');
});

test('color range remains directly editable in the phone settings drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  const settings = page.getByRole('complementary', { name: 'Visualization settings' });
  await expect(settings).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const rangeBar = page.locator('.color-legend__bar');
  const barBounds = await rangeBar.boundingBox();
  const settingsBounds = await settings.boundingBox();
  expect(barBounds).not.toBeNull();
  expect(settingsBounds).not.toBeNull();
  expect(barBounds!.x).toBeGreaterThanOrEqual(settingsBounds!.x);
  expect(barBounds!.x + barBounds!.width).toBeLessThanOrEqual(settingsBounds!.x + settingsBounds!.width);

  await rangeBar.click({ position: { x: barBounds!.width * .01, y: barBounds!.height / 2 } });
  await expect(page.getByLabel('Color range mode')).toHaveValue('fixed');
  await page.getByRole('button', { name: 'Enter exact minimum color value' }).click();
  const editorBounds = await page.locator('.color-range__exact').boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(editorBounds!.x).toBeGreaterThanOrEqual(settingsBounds!.x);
  expect(editorBounds!.x + editorBounds!.width).toBeLessThanOrEqual(settingsBounds!.x + settingsBounds!.width);
});

test('share, download and info expose the immutable scientific context', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { __copiedUrl?: string }).__copiedUrl = value; } },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=4&feature=rms_ap&stat=median');
  const actions = page.locator('.app-header__desktop-actions');

  await actions.getByRole('button', { name: 'Share' }).click();
  await expect(actions.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __copiedUrl?: string }).__copiedUrl)).toBe(page.url());

  await actions.getByRole('button', { name: 'Info' }).click();
  const info = page.getByRole('dialog', { name: 'Dataset information' });
  await expect(info).toBeVisible();
  await expect(info).toContainText('Synthetic test fixture');
  await expect(info).toContainText('golden-v1');
  await expect(info).toContainText('AP RMS (golden fixture)');
  await expect(info).toContainText('dB rel. V');
  await expect(info).toContainText('golden-fixture-v1');
  await expect(info).toContainText('Deterministic synthetic fixture seed');
  await info.getByRole('button', { name: 'Close' }).click();

  const downloadPromise = page.waitForEvent('download');
  await actions.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ephys_atlas_channels-golden-v1-rms_ap-allen-median.csv');
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('dataset_id,release_id,feature_id,representation,parcellation,statistic,unit,region_id,acronym,region_name,value');
  expect(csv).toContain('ephys_atlas_channels,golden-v1,rms_ap,regional,allen,median,dB rel. V');
});

test('renderer region selection flows back into shared URL state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await path.dispatchEvent('pointerup');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect(page.locator('.selected-region')).toContainText('MD');

  const projection = page.locator('[data-view="coronal"] .view-frame__brain-svg');
  const unselected = projection.locator('path[data-allen-id="-1009"]').first();
  await expect(projection).toHaveClass(/has-region-selection/);
  await expect(path).toHaveCSS('fill-opacity', '1');
  await expect(unselected).toHaveCSS('fill-opacity', '0.58');
  await expect(unselected).toHaveCSS('filter', 'none');

  await unselected.dispatchEvent('pointermove');
  await expect(unselected).toHaveClass(/is-highlighted/);
  await expect(unselected).toHaveCSS('fill-opacity', '1');
  await page.locator('[data-view="coronal"] .view-frame__slice-figure').dispatchEvent('pointerleave');
  await expect(unselected).toHaveCSS('fill-opacity', '0.58');
});

test('region hover is linked across all anatomical projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');

  const source = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await expect(source).toHaveAttribute('style', /fill:/);
  const sourceStyle = await source.getAttribute('style');
  await source.dispatchEvent('pointermove');
  await expect(page.locator('.region-row[data-region-id="-362"]')).toHaveAttribute('data-hovered', 'true');
  const histogramMarker = page.locator('.distribution-chart__hover-marker');
  await expect(histogramMarker).toHaveAttribute('data-visible', 'true');
  await expect(histogramMarker).toHaveAttribute('data-region-id', '-362');
  await expect(page.locator('.distribution-chart__hover-label')).toHaveText('MD · 1 dB rel. V');
  await expect(page.locator('.distribution-chart__hover-dot')).toHaveAttribute('cx', '375');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const highlighted = page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first();
    await expect(highlighted).toHaveClass(/is-highlighted/);
    await expect(highlighted).not.toHaveClass(/is-selected/);
    if (axis === 'coronal') await expect(highlighted).toHaveAttribute('style', sourceStyle ?? '');
    await expect(highlighted).toHaveCSS('filter', 'brightness(1.22) saturate(1.12)');
  }

  await page.locator('[data-view="coronal"] .view-frame__slice-figure').dispatchEvent('pointerleave');
  await expect(histogramMarker).toHaveAttribute('data-visible', 'false');
  await expect(page.locator('.distribution-chart__hover-label')).toBeHidden();
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    await expect(page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first()).not.toHaveClass(/is-highlighted/);
  }
});

test('slice hover tooltip shows current regional value and stays inside its viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);

  const viewport = page.locator('[data-view="coronal"] .view-frame__viewport');
  const viewportBounds = await viewport.boundingBox();
  expect(viewportBounds).not.toBeNull();
  const leftPath = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await leftPath.dispatchEvent('pointermove', {
    clientX: viewportBounds!.x + viewportBounds!.width - 2,
    clientY: viewportBounds!.y + viewportBounds!.height - 2,
  });

  const tooltip = page.locator('[data-view="coronal"] .region-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute('data-region-id', '-362');
  await expect(tooltip.locator('.region-tooltip__identity')).toContainText('MD');
  await expect(tooltip.locator('.region-tooltip__identity')).toContainText('Mediodorsal nucleus of thalamus');
  await expect(tooltip.locator('.region-tooltip__value-label')).toHaveText('Mean');
  await expect(tooltip.locator('.region-tooltip__value-text')).toHaveText('1 dB rel. V');
  await expect(tooltip.locator('.region-tooltip__meta')).toHaveText('Left hemisphere · n=3');
  const tooltipBounds = await tooltip.boundingBox();
  expect(tooltipBounds).not.toBeNull();
  expect(tooltipBounds!.x).toBeGreaterThanOrEqual(viewportBounds!.x);
  expect(tooltipBounds!.y).toBeGreaterThanOrEqual(viewportBounds!.y);
  expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(viewportBounds!.x + viewportBounds!.width);
  expect(tooltipBounds!.y + tooltipBounds!.height).toBeLessThanOrEqual(viewportBounds!.y + viewportBounds!.height);

  const rightPath = page.locator('[data-view="coronal"] path[data-allen-id="362"]').first();
  await rightPath.dispatchEvent('pointermove', {
    clientX: viewportBounds!.x + 20,
    clientY: viewportBounds!.y + 20,
  });
  await expect(tooltip.locator('.region-tooltip__meta')).toHaveText('Right hemisphere · anatomy reference · n=3');
  await page.locator('[data-view="coronal"] .view-frame__slice-figure').dispatchEvent('pointerleave');
  await expect(tooltip).toBeHidden();
});

test('region-list hover previews the region in all anatomical projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');

  await page.getByRole('button', { name: /MD, Mediodorsal nucleus of thalamus/ }).hover();
  await expect(page.locator('.distribution-chart__hover-marker')).toHaveAttribute('data-region-id', '-362');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const highlighted = page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first();
    await expect(highlighted).toHaveClass(/is-highlighted/);
    await expect(highlighted).toHaveCSS('filter', 'brightness(1.22) saturate(1.12)');
  }

  await page.getByLabel('Search brain regions').hover();
  await expect(page.locator('.distribution-chart__hover-marker')).toHaveAttribute('data-visible', 'false');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    await expect(page.locator(`[data-view="${axis}"] path[data-allen-id="-362"]`).first()).not.toHaveClass(/is-highlighted/);
  }
});

test('parcellation changes clear stale region hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');

  await page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first().dispatchEvent('pointermove');
  await expect(page.locator('.is-highlighted')).not.toHaveCount(0);
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('parcel', 'beryl');
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  await expect.poll(() => new URL(page.url()).searchParams.get('parcel')).toBe('beryl');
  await expect(page.locator('.is-highlighted')).toHaveCount(0);
  await expect(page.locator('.region-row[data-hovered="true"]')).toHaveCount(0);
});

test('regional tree reapplies hover styling after its rows rerender', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');

  const row = page.locator('.region-row[data-region-id="-362"]');
  await row.locator('.region-row__button').dispatchEvent('pointerover');
  await expect(row).toHaveAttribute('data-hovered', 'true');
  await page.evaluate(() => {
    const statistic = document.querySelector<HTMLSelectElement>('[aria-label="Regional statistic"]');
    if (!statistic) throw new Error('Regional statistic control not found');
    statistic.value = statistic.value === 'mean' ? 'median' : 'mean';
    statistic.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('.region-row[data-region-id="-362"]')).toHaveAttribute('data-hovered', 'true');
  await page.getByLabel('Search brain regions').hover();
  await expect(page.locator('.is-highlighted')).toHaveCount(0);
});

test('region search filters loaded metadata rather than prototype rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
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
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBe('coronal');
  await page.keyboard.press('Escape');
  await expect(frame).toHaveAttribute('data-maximized', 'false');
  await expect(page.locator('.atlas-app')).not.toHaveAttribute('data-maximized-view', /.+/);
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBeNull();
});

test('compact workspace selection hydrates and persists independently', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?v=4&compact=secondary');
  await expect(page.locator('.context-strip')).toBeVisible();
  await expect(page.locator('.slice-strip')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Context' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Sagittal' }).click();
  await expect(page.locator('[data-view="sagittal"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('compact')).toBe('sagittal');
  await expect(new URL(page.url()).searchParams.get('max')).toBeNull();
});

test('projection pack failure is an explicit view-frame error state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/registered/coronal/*.isvg.gz', (route) => route.fulfill({ status: 503, body: 'offline' }));
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
