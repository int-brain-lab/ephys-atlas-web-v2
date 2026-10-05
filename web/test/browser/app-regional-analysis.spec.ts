import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('schema v1 regional fixture drives values, coloring, selection and histogram comparison', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&scale=linear&dist=full');

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
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-minimum', '-0.5');
  await expect(page.locator('.distribution-chart__color-range')).toHaveAttribute('data-maximum', '3.5');
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('data-total', '11');
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('data-probability-sum', '1');
  await expect(page.locator('.distribution-chart')).toHaveAttribute('data-axis-scale', 'linear');
  await expect(page.getByRole('button', { name: 'Linear', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Linear', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('linear');
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
  expect(Math.abs(coronalWhileOpen!.y - coronalBeforeSelection!.y)).toBeLessThanOrEqual(2);
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
  expect(Math.abs(coronalAfterClose!.y - coronalBeforeSelection!.y)).toBeLessThanOrEqual(2);
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
  expect(download.suggestedFilename()).toBe('golden_fixture-golden-v1-rms_ap-allen-selected-comparison.csv');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const comparisonCsv = await readFile(downloadPath!, 'utf8');
  expect(comparisonCsv).toContain('dataset_id,release_id,feature_id,representation,parcellation,selected_statistic,unit,population,value_scale,distribution_domain,symlog_linear_threshold,focus_lower_bound,focus_upper_bound,region_id');
  expect(comparisonCsv).toContain('golden_fixture,golden-v1,rms_ap,regional,allen,mean,dB rel. V');
  expect(comparisonCsv.trim().split('\n')).toHaveLength(9);
  expect(comparisonCsv).toContain(',-362,MD,Mediodorsal nucleus of thalamus (left),');
  await page.getByRole('button', { name: 'Minimize selected-region comparison' }).click();
  await expect(comparisonDialog).toBeHidden();
  await expect(path).toHaveClass(/is-selected/);
  await expect(rightPath).toHaveClass(/is-selected/);
});

test('selected-region comparison becomes a dismissible phone bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/?v=4&selected=-362');

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
  await page.goto('/app/');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Region color mode').selectOption('anatomy');
  await expect.poll(() => new URL(page.url()).searchParams.get('colors')).toBe('anatomy');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  await expect(page.getByRole('button', { name: /MD, Mediodorsal nucleus of thalamus/ })).toBeAttached();
  await expect(page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first()).toHaveCSS('fill', 'rgb(255, 144, 159)');
  await expect(page.locator('[data-view="coronal"] path[data-allen-id="-1009"]').first()).toHaveCSS('fill', 'rgb(97, 111, 121)');
  await expect(page.locator('.region-row__swatch').first()).toBeVisible();
});

test('renderer region selection flows back into shared URL state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
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
  await page.goto('/app/?v=4&scale=linear&dist=full');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');

  const source = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  // Geometry can arrive before the asynchronous feature presentation. Wait for
  // the fixture value color so this captures the state whose hover persistence
  // the test is intended to exercise, rather than a transient anatomy fill.
  await expect(source).toHaveCSS('fill', 'rgb(44, 114, 142)');
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
  await page.goto('/app/');
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
  await expect(tooltip.locator('.region-tooltip__id')).toHaveText('362');
  await expect(tooltip.locator('.region-tooltip__lineage')).toHaveText('BS › IB › TH › DORpm › MED');
  await expect(tooltip.locator('.region-tooltip__value-label')).toHaveText('Mean');
  await expect(tooltip.locator('.region-tooltip__value-text')).toHaveText('1 dB rel. V');
  await expect(tooltip.locator('.region-tooltip__meta')).toHaveText('Left hemisphere · n=3');
  await expect(tooltip.locator('.region-tooltip__hint')).toBeHidden();
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
  await page.goto('/app/');
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
  await page.goto('/app/');
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
  await page.goto('/app/');
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
  await page.goto('/app/');
  await expect(page.locator('.region-search__source')).toHaveText('Allen Mouse CCF 2017');
  const search = page.getByLabel('Search brain regions');
  await search.fill('mediodorsal nucleus of thalamus');
  await expect(page.locator('.region-row:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.region-row:not([hidden])')).toContainText('MD');
  await expect(page.locator('.region-row:visible')).toHaveCount(1);
  await expect(page.locator('.region-row[data-region-id="-567"]')).toBeHidden();
});

