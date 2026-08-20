import { expect, test, type Page } from '@playwright/test';

const ranges = {
  coronal: { min: 2, max: 1316, step: 2 },
  sagittal: { min: 54, max: 1086, step: 2 },
  horizontal: { min: 16, max: 754, step: 2 },
} as const;

function bundle(axis: keyof typeof ranges): Record<string, string> {
  const { min, max, step } = ranges[axis];
  const out: Record<string, string> = {};
  for (let index = min; index <= max; index += step) {
    out[String(index)] = '<path d="M0 0h10v10H0z" class="allen_region_10 beryl_region_10 cosmos_region_10"/>';
  }
  return out;
}

async function mockCuratedSlices(page: Page): Promise<void> {
  await page.route('https://atlas.internationalbrainlab.org/data/json/slices_*.json', async (route) => {
    const axis = route.request().url().match(/slices_(coronal|sagittal|horizontal)\.json/)?.[1] as keyof typeof ranges | undefined;
    if (!axis) return route.abort();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle(axis)) });
  });
}

test('regional runtime reaches a decoded feature payload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/');

  await expect.poll(async () => page.evaluate(() => {
    const app = (globalThis as any).__IBL_ATLAS_APP__;
    if (!app) return 'app:missing';
    const state = app.store?.getState?.();
    if (state?.runtime?.error) return `error:${state.runtime.error}`;
    if (!app.manifest) return 'manifest:missing';
    if (!Array.isArray(app.regions) || app.regions.length === 0) return `regions:${app.regions?.length ?? 'missing'}`;
    return app.feature?.representation ?? 'feature:missing';
  }), { timeout: 10_000 }).toBe('regional');
});
