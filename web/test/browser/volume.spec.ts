import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('volume summary and exact valid-voxel distribution reuse the loaded summary resource', async ({ page }) => {
  const summaryRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/features/rms_ap/volume/summary.json')) summaryRequests.push(request.url());
  });
  await page.goto('/?v=4&feature=rms_ap&repr=volume&secondary=summary&selected=-362&cursor=25,25,25&scale=linear&dist=full');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);

  const summary = page.locator('.secondary-view__summary');
  await expect(summary).toContainText('Valid voxels');
  await expect(summary).toContainText('191');
  await expect(summary).toContainText('Mean');
  await expect(summary).toContainText('9.6');
  await expect(summary).toContainText(
    '192 grid voxels: 191 valid, 0 outside, and 1 missing. Statistics and distribution use valid voxels only.',
  );

  const distribution = page.locator('.distribution-chart');
  await expect(distribution).toHaveAttribute('data-axis-scale', 'linear');
  await expect(distribution).toContainText('Valid-voxel distribution');
  await expect(distribution).toContainText('Valid voxels · n=191');
  await expect(distribution.locator('.distribution-chart__bin')).toHaveCount(8);
  await expect(distribution.locator('.distribution-chart__global')).toHaveAttribute('data-total', '191');
  await expect(distribution.locator('.distribution-chart__region')).toHaveCount(0);
  const log = distribution.getByRole('button', { name: 'Log', exact: true });
  await expect(log).toBeEnabled();
  await expect(distribution.getByRole('button', { name: 'Signed log' })).toBeEnabled();
  await expect(distribution.locator('.distribution-chart__color-range')).toHaveAttribute('data-visible', 'true');
  await expect(distribution.locator('.distribution-chart__color-range')).toHaveAttribute('data-minimum', '0.1');
  await expect(distribution.locator('.distribution-chart__color-range')).toHaveAttribute('data-maximum', '19.1');

  expect(summaryRequests).toHaveLength(1);
  await page.getByRole('tab', { name: 'Top' }).click();
  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(summary).toBeVisible();
  expect(summaryRequests).toHaveLength(1);
});

test('volume layer settings only appear for volume representations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.volume-layer-settings')).toBeHidden();

  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25&scale=linear&dist=full');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.volume-layer-settings')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Volume opacity' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Show anatomy outlines' })).toBeVisible();
});

test('volume features expose and download their immutable declared artifacts', async ({ page }) => {
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);

  const actions = page.locator('.app-header__desktop-actions');
  await expect(actions.getByRole('button', { name: 'Download' })).toBeEnabled();
  await actions.getByRole('button', { name: 'Download' }).click();
  const downloads = page.getByRole('dialog', { name: 'Download feature data' });
  await expect(downloads).toContainText('Downloads preserve the bytes declared by this immutable release');
  const artifact = downloads.getByRole('button', { name: /Human-readable regional fixture values/ });
  await expect(artifact).toContainText('Current feature · rms_ap.csv · 45 B');

  const downloadPromise = page.waitForEvent('download');
  await artifact.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rms_ap.csv');
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, 'utf8')).toBe('atlas_id,mean\n-362,1\n-382,2\n-477,0\n-803,3.25\n');
});

test('volume artifact integrity failures remain explicit and do not download corrupt bytes', async ({ page }) => {
  await page.route('**/features/rms_ap/rms_ap.csv', (route) => route.fulfill({
    status: 200,
    contentType: 'text/csv',
    body: 'x'.repeat(45),
  }));
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25');
  const actions = page.locator('.app-header__desktop-actions');
  await actions.getByRole('button', { name: 'Download' }).click();
  const downloads = page.getByRole('dialog', { name: 'Download feature data' });
  await downloads.getByRole('button', { name: /Human-readable regional fixture values/ }).click();
  await expect(downloads.getByRole('alert')).toHaveText('Resource SHA-256 mismatch');
  await expect(downloads).toBeVisible();
});

test('schema-v1 chunks3d volume renders all three orthogonal golden slices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=1,0,2');

  await expect.poll(() => new URL(page.url()).searchParams.get('repr')).toBe('volume');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const target = page.locator(`[data-view="${axis}"] .view-frame__renderer`);
    await expect(target).toHaveAttribute('data-slice-asset', 'schema-volume-v1');
    await expect(target).toHaveAttribute('data-volume-feature', 'rms_ap');
    await expect(target).toHaveAttribute('data-volume-index', '0');
    await expect(target.locator('canvas.view-frame__volume-canvas')).toBeAttached();
    await expect(target.locator('.projection-viewport')).toHaveAttribute('data-mode', 'composite');
    await expect(target.locator('svg.projection-viewport__scalar')).toBeAttached();
    await expect(target.locator('svg.projection-viewport__regional')).toBeAttached();
    await expect(target.locator('.projection-viewport__scalar-host')).toHaveAttribute('width', /\d/);
    await expect(target.locator('canvas.view-frame__volume-canvas')).toHaveAttribute('data-flip-y', 'true');
    const layerBoundsDelta = await target.evaluate((node) => {
      const scalar = node.querySelector<SVGSVGElement>('svg.projection-viewport__scalar')!.getBoundingClientRect();
      const regional = node.querySelector<SVGSVGElement>('svg.projection-viewport__regional')!.getBoundingClientRect();
      return Math.max(
        Math.abs(scalar.left - regional.left),
        Math.abs(scalar.top - regional.top),
        Math.abs(scalar.width - regional.width),
        Math.abs(scalar.height - regional.height),
      );
    });
    expect(layerBoundsDelta).toBeLessThan(0.1);
  }

  await expect(page.locator('[data-view="coronal"] canvas')).toHaveJSProperty('width', 6);
  await expect(page.locator('[data-view="coronal"] canvas')).toHaveJSProperty('height', 4);
  await expect(page.locator('[data-view="sagittal"] canvas')).toHaveJSProperty('width', 8);
  await expect(page.locator('[data-view="sagittal"] canvas')).toHaveJSProperty('height', 4);
  await expect(page.locator('[data-view="horizontal"] canvas')).toHaveJSProperty('width', 6);
  await expect(page.locator('[data-view="horizontal"] canvas')).toHaveJSProperty('height', 8);

  const coronal = page.locator('[data-view="coronal"]');
  await coronal.evaluate((frame) => {
    const host = frame.querySelector<SVGGraphicsElement>('.projection-viewport__scalar-host')!;
    const regional = frame.querySelector<SVGSVGElement>('svg.projection-viewport__regional')!;
    const bounds = host.getBoundingClientRect();
    regional.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }));
  });
  await expect(coronal.locator('.region-tooltip')).toBeVisible();
  const tooltip = coronal.locator('.region-tooltip');
  await expect(tooltip).toContainText('Voxel');
  await expect(tooltip).toContainText(/voxel \d,\d,\d/);
  await expect(tooltip.locator('.region-tooltip__value-label')).toHaveCount(0);
  await expect(tooltip.locator('.region-tooltip__meta')).toHaveCSS('white-space', 'pre-line');
  expect(await tooltip.locator('.region-tooltip__meta').textContent()).toMatch(/voxel \d,\d,\d\nML /);
  expect(await tooltip.locator('.region-tooltip__meta').textContent()).toMatch(/ML [^\n]+ · AP [^\n]+ · DV [^\n]+ mm$/);
  expect((await tooltip.boundingBox())?.width).toBeLessThanOrEqual(224);
});

test('an out-of-grid world cursor fails explicitly without fetching a clamped edge plane', async ({ page }) => {
  const chunkRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/volume/chunks/')) chunkRequests.push(request.url());
  });
  await page.goto('/?v=4&feature=rms_ap&repr=volume');

  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const frame = page.locator(`[data-view="${axis}"]`);
    await expect(frame).toHaveAttribute('data-state', 'ready');
    await expect(frame.locator('.view-frame__renderer')).toHaveAttribute('data-slice-asset', 'projection-pack-v1');
    await expect(frame.locator('.view-frame__status')).toHaveText('Anatomy only');
    await expect(frame.locator('.projection-viewport__error')).toContainText(
      `${axis} cursor is outside the declared volume extent`,
    );
  }
  expect(chunkRequests).toEqual([]);
});

test('switching regional to volume preserves each retained layer stack', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  await page.evaluate(() => {
    history.replaceState({}, '', '/?v=4&cursor=25,25,25');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.evaluate(() => {
    const state = window as Window & { __retainedProjectionNodes?: Element[] };
    state.__retainedProjectionNodes = [...document.querySelectorAll(
      '.view-frame__renderer > .projection-viewport, .view-frame__renderer canvas, .view-frame__renderer svg',
    )];
  });

  const representation = page.locator('[data-context-field="representation"]');
  await representation.locator('.context-menu__trigger').click();
  await representation.getByRole('option', { name: /Volume/ }).click();
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);

  expect(await page.evaluate(() => {
    const state = window as Window & { __retainedProjectionNodes?: Element[] };
    const current = [...document.querySelectorAll(
      '.view-frame__renderer > .projection-viewport, .view-frame__renderer canvas, .view-frame__renderer svg',
    )];
    return state.__retainedProjectionNodes?.every((node, index) => node === current[index]);
  })).toBe(true);

  await representation.locator('.context-menu__trigger').click();
  await representation.getByRole('option', { name: /Regional/ }).click();
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  await expect(page.locator('.projection-viewport[data-mode="regional"]')).toHaveCount(3);
});

test('URL-persisted layer controls repaint retained layers without volume requests', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/volume/chunks/')) chunks.push(request.url());
  });
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25&opacity=0.4&outlines=0');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  await expect(page.locator('.projection-viewport__scalar').first()).toHaveCSS('opacity', '0.4');
  await expect(page.locator('.projection-viewport').first()).toHaveAttribute('data-anatomy-outlines', 'false');
  await page.waitForTimeout(200);
  const baseline = chunks.length;

  await page.getByRole('button', { name: 'Settings' }).click();
  const opacity = page.getByRole('slider', { name: 'Volume opacity' });
  await expect(opacity).toHaveValue('0.4');
  await opacity.evaluate((input: HTMLInputElement) => {
    input.value = '0.25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('checkbox', { name: 'Show anatomy outlines' }).check();

  await expect(page.locator('.projection-viewport__scalar').first()).toHaveCSS('opacity', '0.25');
  await expect(page.locator('.projection-viewport').first()).toHaveAttribute('data-anatomy-outlines', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('opacity')).toBe('0.25');
  await expect.poll(() => new URL(page.url()).searchParams.has('outlines')).toBe(false);
  expect(chunks.length).toBe(baseline);
});

test('reduced-parcellation volume selection keeps the target vivid under a neutral veil', async ({ page }) => {
  await page.goto('/?v=4&feature=rms_ap&repr=volume&parcel=cosmos&cursor=25,25,25');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  const projection = page.locator('[data-view="coronal"] .projection-viewport');
  const source = projection.locator('path[data-cosmos-id]').first();
  await source.dispatchEvent('pointerup');

  await expect(projection.locator('path.is-selected').first()).toBeAttached();
  for (const selected of await projection.locator('path.is-selected').all()) {
    await expect(selected).toHaveCSS('fill-opacity', '0');
    await expect(selected).toHaveCSS('stroke-width', '1.75px');
  }
  const unselected = projection.locator('path:not(.is-selected)').first();
  await expect(unselected).toHaveCSS('fill', 'rgb(232, 242, 248)');
  await expect(unselected).toHaveCSS('fill-opacity', '0.35');
  await unselected.dispatchEvent('pointermove');
  await expect(unselected).toHaveClass(/is-highlighted/);
  await expect(unselected).toHaveCSS('fill-opacity', '0');
  await expect(unselected).toHaveCSS('stroke-width', '1.2px');
});

test('volume navigation keeps composites visible and repaints only a changed scalar plane', async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.putImageData;
    const state = window as Window & { __volumePaintCounts?: Record<string, number> };
    state.__volumePaintCounts = {};
    CanvasRenderingContext2D.prototype.putImageData = function putImageData(
      this: CanvasRenderingContext2D,
      ...args: Parameters<CanvasRenderingContext2D['putImageData']>
    ) {
      const axis = this.canvas.closest<HTMLElement>('[data-view]')?.dataset.view;
      if (axis) state.__volumePaintCounts![axis] = (state.__volumePaintCounts![axis] ?? 0) + 1;
      return original.apply(this, args);
    };
  });
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25&scale=linear&dist=full');
  const frame = page.locator('[data-view="coronal"]');
  await expect(frame.locator('[data-slice-asset="schema-volume-v1"]')).toBeAttached();
  await expect(frame).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-view="sagittal"]')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-view="horizontal"]')).toHaveAttribute('data-state', 'ready');
  const initialVolumeIndex = await frame.locator('.view-frame__renderer').getAttribute('data-volume-index');
  expect(initialVolumeIndex).not.toBeNull();
  await page.evaluate(() => {
    const state = window as Window & {
      __volumeModeTransitions?: string[];
      __volumeModeObservers?: MutationObserver[];
      __volumePaintCounts?: Record<string, number>;
    };
    state.__volumePaintCounts = {};
    state.__volumeModeTransitions = [];
    state.__volumeModeObservers = [...document.querySelectorAll<HTMLElement>('.projection-viewport')].map((root) => {
      const observer = new MutationObserver(() => state.__volumeModeTransitions!.push(root.dataset.mode ?? ''));
      observer.observe(root, { attributes: true, attributeFilter: ['data-mode'] });
      return observer;
    });
  });

  await page.getByLabel('coronal slice').evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.value = String(slider.valueAsNumber - 1);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (
    window as Window & { __volumePaintCounts?: Record<string, number> }
  ).__volumePaintCounts)).toEqual({});

  await page.evaluate(() => {
    (window as Window & { __volumePaintCounts?: Record<string, number> }).__volumePaintCounts = {};
  });
  await page.getByLabel('coronal slice').evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.value = String(slider.valueAsNumber - 1);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => frame.locator('.view-frame__renderer').getAttribute('data-volume-index'))
    .not.toBe(initialVolumeIndex);

  expect(await page.evaluate(() => (
    window as Window & { __volumePaintCounts?: Record<string, number> }
  ).__volumePaintCounts)).toEqual({ coronal: 1 });
  expect(await page.evaluate(() => (
    window as Window & { __volumeModeTransitions?: string[] }
  ).__volumeModeTransitions)).toEqual([]);
  await expect(page.locator('.projection-viewport[data-mode="composite"]')).toHaveCount(3);
  await page.evaluate(() => {
    const state = window as Window & { __volumeModeObservers?: MutationObserver[] };
    state.__volumeModeObservers?.forEach((observer) => observer.disconnect());
  });
});
