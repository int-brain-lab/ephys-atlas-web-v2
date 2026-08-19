import { expect, test, type Page } from '@playwright/test';

const reviewViewports = [
  { name: 'wide-desktop', width: 1680, height: 1050, layout: 'wide', body: { x: 8, y: 72, width: 1664, height: 970 } },
  { name: 'compact-desktop', width: 1440, height: 900, layout: 'compact', body: { x: 8, y: 72, width: 1424, height: 820 } },
  { name: 'compact-laptop', width: 1280, height: 800, layout: 'compact', body: { x: 8, y: 72, width: 1264, height: 720 } },
  { name: 'tablet', width: 1024, height: 768, layout: 'narrow', body: { x: 8, y: 72, width: 1008, height: 688 } },
  { name: 'phone', width: 390, height: 844, layout: 'phone', body: { x: 4, y: 60, width: 382, height: 780 } },
] as const;

const reviewFragments = {
  coronal: '<path d="M78 184 C72 123 101 77 158 64 C195 55 224 68 237 92 C252 67 287 54 329 68 C378 83 402 125 393 183 C385 230 347 267 294 276 C264 281 245 269 237 248 C228 269 207 281 175 276 C123 267 85 230 78 184 Z"/>',
  sagittal: '<path d="M71 183 C80 129 121 94 174 84 C226 74 289 80 350 104 C390 120 407 147 395 176 C381 208 339 232 284 240 C221 250 156 245 112 226 C82 213 66 198 71 183 Z"/>',
  horizontal: '<path d="M144 157 C146 104 181 73 231 66 C282 59 326 79 347 117 C371 158 361 211 327 246 C303 271 270 281 237 267 C207 282 175 272 151 249 C117 216 112 174 144 157 Z"/>',
} as const;

async function mockCuratedSlices(page: Page): Promise<void> {
  await page.route('https://atlas.internationalbrainlab.org/data/json/slices_*.json', async (route) => {
    const axis = route.request().url().match(/slices_(coronal|sagittal|horizontal)\.json/)?.[1] as keyof typeof reviewFragments | undefined;
    if (!axis) return route.abort();
    const index = axis === 'coronal' ? 660 : axis === 'sagittal' ? 550 : 400;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ [index]: reviewFragments[axis] }),
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
  await slider.fill('700');
  await expect(page.locator('[data-view="coronal"] .view-frame__coordinate')).toHaveText('AP -1.60 mm');
  await expect(page).toHaveURL(/slices=700,550,400/);
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
      const index = axis === 'sagittal' ? 550 : 400;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ [index]: reviewFragments[axis] }) });
    }
  });
  await page.goto('/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-view="coronal"] .view-frame__status')).toHaveText('Unavailable');
});

test('phase 3 region search and prototype selection remain local', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');
  const search = page.getByLabel('Search brain regions');
  await search.fill('somato');
  await expect(page.locator('.region-row:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.region-row:not([hidden])')).toContainText('SSp-bfd');
  await expect(page).not.toHaveURL(/selected=/);
});

test('drawers still close on Escape and composition changes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mockCuratedSlices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Visualization settings')).toHaveAttribute('data-open', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Visualization settings')).toHaveAttribute('data-open', 'false');
  await page.getByRole('button', { name: 'Regions' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel('Brain regions')).toHaveAttribute('data-open', 'false');
});
