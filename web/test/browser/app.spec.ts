import { expect, test, type Page } from '@playwright/test';

const reviewViewports = [
  { name: 'wide-desktop', width: 1680, height: 1050, layout: 'wide', body: { x: 8, y: 72, width: 1664, height: 970 } },
  { name: 'compact-desktop', width: 1440, height: 900, layout: 'compact', body: { x: 8, y: 72, width: 1424, height: 820 } },
  { name: 'compact-laptop', width: 1280, height: 800, layout: 'compact', body: { x: 8, y: 72, width: 1264, height: 720 } },
  { name: 'tablet', width: 1024, height: 768, layout: 'narrow', body: { x: 8, y: 72, width: 1008, height: 688 } },
  { name: 'phone', width: 390, height: 844, layout: 'phone', body: { x: 4, y: 60, width: 382, height: 780 } },
] as const;

const reviewFragments = {
  // Geometry is sampled from the curated assets. Allen atlas ID 10 is legacy
  // BrainRegions index 835, so the fixture exercises the real ID crosswalk.
  coronal: '<path d="M236.473 167.48v-4.34 4.34z" class="allen_region_835"/>',
  sagittal: '<path d="M160.137 184.944v-2.721 2.721z" class="allen_region_835"/>',
  horizontal: '<path d="M298.858 147.01v-.404.404z" class="allen_region_835"/>',
} as const;

const curatedRanges = {
  coronal: { min: 2, max: 1316, step: 2 },
  sagittal: { min: 54, max: 1086, step: 2 },
  horizontal: { min: 16, max: 754, step: 2 },
} as const;

function fixtureBundle(axis: keyof typeof reviewFragments): Record<string, string> {
  const { min, max, step } = curatedRanges[axis];
  const bundle: Record<string, string> = {};
  for (let index = min; index <= max; index += step) bundle[String(index)] = reviewFragments[axis];
  return bundle;
}

async function mockCuratedSlices(page: Page): Promise<void> {
  await page.route('https://atlas.internationalbrainlab.org/data/json/regions.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ allen: [{ acronym: 'SCig', atlas_id: 10, idx: 835 }] }),
  }));
  await page.route('https://atlas.internationalbrainlab.org/data/json/slices_*.json', async (route) => {
    const axis = route.request().url().match(/slices_(coronal|sagittal|horizontal)\.json/)?.[1] as keyof typeof reviewFragments | undefined;
    if (!axis) return route.abort();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureBundle(axis)),
    });
  });
}

for (const viewport of reviewViewports) {
  test(`phase 4 anatomical frames: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockCuratedSlices(page);
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
    await expect(page.locator('[data-view="coronal"] [data-slice-asset="legacy-curated-v1"]')).toBeAttached();
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
  await mockCuratedSlices(page);
  await page.goto('/');

  const slider = page.getByLabel('coronal slice');
  await slider.fill('701');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.61 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('slices')).toBe('701,550,400');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '700');
});

test('mouse wheel over an SVG steps its scientific slice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');

  await page.locator('[data-view="coronal"] .view-frame__brain-svg').dispatchEvent('wheel', { deltaY: 100 });
  await expect(page.getByLabel('coronal slice')).toHaveValue('656');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.16 mm');
  await expect.poll(() => new URL(page.url()).searchParams.get('slices')).toBe('656,550,400');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '656');
});

test('full-resolution navigation stays independent from downsampled SVG assets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/?v=1&slices=661,551,401');

  await expect(page.getByLabel('coronal slice')).toHaveValue('661');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('551');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('401');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.21 mm');
  await expect(page.locator('[data-view="sagittal"] .view-frame__coordinate')).toHaveText('ML -0.23 mm');
  await expect(page.locator('[data-view="horizontal"] .view-frame__coordinate')).toHaveText('DV -3.68 mm');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '660');
  await expect(page.locator('[data-view="sagittal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '550');
  await expect(page.locator('[data-view="horizontal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '400');
});

test('scientific range endpoints may reuse the nearest available display SVG', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/?v=1&slices=0,1139,799');

  await expect(page.getByLabel('coronal slice')).toHaveValue('0');
  await expect(page.getByLabel('sagittal slice')).toHaveValue('1139');
  await expect(page.getByLabel('horizontal slice')).toHaveValue('799');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '2');
  await expect(page.locator('[data-view="sagittal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '1086');
  await expect(page.locator('[data-view="horizontal"] [data-slice-asset="legacy-curated-v1"]')).toHaveAttribute('data-asset-index', '754');
});

test('schema v0.1 regional fixture drives values, coloring, selection and histogram comparison', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');

  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');
  await expect(page.locator('.region-row')).toHaveCount(4);
  await expect(page.locator('.region-row').first()).toContainText('R1');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  await expect(page.locator('.regional-comparison__fixture')).toHaveText('Synthetic integration fixture');

  const path = page.locator('[data-view="coronal"] path.allen_region_835').first();
  await expect(path).toHaveAttribute('style', /fill:/);

  await page.getByRole('button', { name: 'R1, Fixture region 1' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('10');
  await expect(page.locator('.selected-region')).toContainText('R1');
  await expect(page.locator('.regional-comparison__list')).toContainText('mean: 1 dB rel. V');
  await expect(path).toHaveClass(/is-selected/);
});

test('renderer region selection flows back into shared URL state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');
  const path = page.locator('[data-view="coronal"] path.allen_region_835').first();
  await path.dispatchEvent('pointerup');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('10');
  await expect(page.locator('.selected-region')).toContainText('R1');
});

test('region hover is linked across all anatomical projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');

  const source = page.locator('[data-view="coronal"] path.allen_region_835').first();
  await source.dispatchEvent('pointermove');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    await expect(page.locator(`[data-view="${axis}"] path.allen_region_835`).first()).toHaveClass(/is-highlighted/);
  }

  await page.locator('[data-view="coronal"] .view-frame__slice-figure').dispatchEvent('pointerleave');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    await expect(page.locator(`[data-view="${axis}"] path.allen_region_835`).first()).not.toHaveClass(/is-highlighted/);
  }
});

test('region search filters loaded metadata rather than prototype rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');
  await expect(page.locator('.region-search__source')).toHaveText('Synthetic schema-v0.1 fixture');
  const search = page.getByLabel('Search brain regions');
  await search.fill('fixture region 3');
  await expect(page.locator('.region-row:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.region-row:not([hidden])')).toContainText('R3');
});

test('view maximize is reversible with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');

  const frame = page.locator('[data-view="coronal"]');
  await page.getByRole('button', { name: 'Maximize coronal view' }).click();
  await expect(frame).toHaveAttribute('data-maximized', 'true');
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-maximized-view', 'coronal');
  await page.keyboard.press('Escape');
  await expect(frame).toHaveAttribute('data-maximized', 'false');
  await expect(page.locator('.atlas-app')).not.toHaveAttribute('data-maximized-view', /.+/);
});

test('curated asset failure is an explicit view-frame error state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('https://atlas.internationalbrainlab.org/data/json/slices_*.json', async (route) => {
    if (route.request().url().includes('slices_coronal')) await route.fulfill({ status: 503, body: 'offline' });
    else {
      const axis = route.request().url().includes('sagittal') ? 'sagittal' : 'horizontal';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureBundle(axis)) });
    }
  });
  await page.goto('/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-view="coronal"] .view-frame__status')).toHaveText('Unavailable');
});

test('drawers still close on Escape and composition changes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mockCuratedSlices(page);
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
