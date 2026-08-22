import { expect, test, type Page } from '@playwright/test';

const fragments = {
  coronal: '<path d="M0 0h10v10H0z" class="allen_region_10 beryl_region_10 cosmos_region_10"/>',
  sagittal: '<path d="M0 0h10v10H0z" class="allen_region_10 beryl_region_10 cosmos_region_10"/>',
  horizontal: '<path d="M0 0h10v10H0z" class="allen_region_10 beryl_region_10 cosmos_region_10"/>',
} as const;

const ranges = {
  coronal: { min: 2, max: 1316, step: 2 },
  sagittal: { min: 54, max: 1086, step: 2 },
  horizontal: { min: 16, max: 754, step: 2 },
} as const;

function bundle(axis: keyof typeof fragments): Record<string, string> {
  const { min, max, step } = ranges[axis];
  const out: Record<string, string> = {};
  for (let index = min; index <= max; index += step) out[String(index)] = fragments[axis];
  return out;
}

async function mockCuratedSlices(page: Page): Promise<void> {
  await page.route('https://atlas.internationalbrainlab.org/data/json/slices_*.json', async (route) => {
    const axis = route.request().url().match(/slices_(coronal|sagittal|horizontal)\.json/)?.[1] as keyof typeof fragments | undefined;
    if (!axis) return route.abort();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle(axis)) });
  });
}

test('schema-v1 chunks3d volume renders all three orthogonal golden slices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCuratedSlices(page);
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=1,0,2');

  await expect.poll(() => new URL(page.url()).searchParams.get('repr')).toBe('volume');
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const target = page.locator(`[data-view="${axis}"] .view-frame__renderer`);
    await expect(target).toHaveAttribute('data-slice-asset', 'schema-volume-v1');
    await expect(target).toHaveAttribute('data-volume-feature', 'rms_ap');
    await expect(target).toHaveAttribute('data-volume-index', '0');
    await expect(target.locator('canvas.view-frame__volume-canvas')).toBeAttached();
  }

  await expect(page.locator('[data-view="coronal"] canvas')).toHaveJSProperty('width', 6);
  await expect(page.locator('[data-view="coronal"] canvas')).toHaveJSProperty('height', 4);
  await expect(page.locator('[data-view="sagittal"] canvas')).toHaveJSProperty('width', 8);
  await expect(page.locator('[data-view="sagittal"] canvas')).toHaveJSProperty('height', 4);
  await expect(page.locator('[data-view="horizontal"] canvas')).toHaveJSProperty('width', 6);
  await expect(page.locator('[data-view="horizontal"] canvas')).toHaveJSProperty('height', 8);
});
