import { expect, test, type Locator, type Page } from '@playwright/test';

// Curved SVG regions need a point in their fill, rather than their bounding-box centre.
async function interiorPosition(locator: Locator): Promise<{ x: number; y: number }> {
  return locator.evaluate((node) => {
    const path = node as SVGPathElement;
    const transform = path.getScreenCTM()!;
    const bounds = path.getBBox();
    for (let row = 1; row < 40; row++) {
      for (let column = 1; column < 40; column++) {
        const local = new DOMPoint(bounds.x + bounds.width * column / 40, bounds.y + bounds.height * row / 40);
        if (!path.isPointInFill(local)) continue;
        const screen = local.matrixTransform(transform);
        if (document.elementFromPoint(screen.x, screen.y) === path) return { x: screen.x, y: screen.y };
      }
    }
    throw new Error('No visible interior point in the selected SVG region');
  });
}

async function clickInterior(page: Page, path: Locator, modifier?: 'Meta' | 'Control'): Promise<void> {
  const point = await interiorPosition(path);
  if (modifier) await page.keyboard.down(modifier);
  try { await page.mouse.click(point.x, point.y); }
  finally { if (modifier) await page.keyboard.up(modifier); }
}

test('Top and Swanson share regional presentation, interaction, URL state, and maximize behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&secondary=top');

  const secondary = page.locator('.secondary-view');
  const top = page.locator('[data-secondary-panel="top"]');
  await expect(page.getByRole('combobox', { name: 'Context view' })).toHaveValue('top');
  await expect(top).toBeVisible();
  await expect(top.locator('path.atlas-region')).toHaveCount(114);
  await expect(top.locator('.secondary-projection__notice')).toBeHidden();
  await expect(top.locator('.static-projection-viewport')).toHaveAttribute('data-synthetic-fixture', 'false');
  await expect(top.locator('.static-projection-viewport')).toHaveAttribute(
    'data-static-source-mode',
    'pinned-curated',
  );

  const path = top.locator('path.atlas-region').last();
  const topRegionId = await path.getAttribute('data-allen-id');
  expect(topRegionId).not.toBeNull();
  const selectedTopRegionId = String(-Math.abs(Number(topRegionId)));
  await path.hover();
  await expect(path).toHaveClass(/is-highlighted/);
  await expect(page.locator('.region-inspection__compact')).not.toHaveText('');
  await path.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe(selectedTopRegionId);

  await page.getByRole('combobox', { name: 'Context view' }).selectOption({ label: 'Swanson' });
  const swanson = page.locator('[data-secondary-panel="swanson"]');
  await expect(swanson).toBeVisible();
  await expect(swanson.locator('path.atlas-region')).toHaveCount(808);
  const swansonPath = swanson.locator('path.atlas-region').last();
  const swansonRegionId = await swansonPath.getAttribute('data-allen-id');
  expect(swansonRegionId).not.toBeNull();
  const selectedSwansonRegionId = String(-Math.abs(Number(swansonRegionId)));
  const swansonInterior = await interiorPosition(swansonPath);
  await page.mouse.move(swansonInterior.x, swansonInterior.y);
  await expect(page.locator('.region-inspection__compact')).not.toHaveText('');
  await clickInterior(page, swansonPath);
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe(selectedSwansonRegionId);
  await clickInterior(page, swansonPath, 'Meta');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBeNull();
  await page.getByRole('combobox', { name: 'Context view' }).selectOption({ label: 'Top' });
  await path.click();
  await page.getByRole('combobox', { name: 'Context view' }).selectOption({ label: 'Swanson' });
  await clickInterior(page, swansonPath, 'Control');
  const expectedIds = [...new Set([selectedTopRegionId, selectedSwansonRegionId])];
  if (selectedTopRegionId === selectedSwansonRegionId) expectedIds.length = 0;
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe(expectedIds.join(',') || null);
  await expect.poll(() => new URL(page.url()).searchParams.get('secondary')).toBe('swanson');

  await page.getByRole('button', { name: 'Maximize secondary panel' }).click();
  await expect(secondary).toHaveAttribute('data-maximized', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBe('secondary');
  await page.keyboard.press('Escape');
  await expect(secondary).toHaveAttribute('data-maximized', 'false');
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBeNull();
});

test('static projections occupy the responsive secondary workspace without becoming slice views', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/app/?v=4&secondary=top&compact=secondary');

  await expect(page.locator('.context-strip')).toBeVisible();
  await expect(page.locator('.slice-strip')).toBeHidden();
  await expect(page.locator('[data-secondary-panel="top"]')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Context view' })).toHaveValue('top');
  await expect(page.getByRole('button', { name: 'Context', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-secondary-panel="top"] input[type="range"]')).toHaveCount(0);
});

test('volume features remain explicitly anatomy-only on affine-free static maps', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/app/?v=4&feature=rms_ap&repr=volume&secondary=top&compact=secondary&cursor=25,25,25');

  const top = page.locator('[data-secondary-panel="top"]');
  await expect(top.locator('path')).toHaveCount(114);
  await expect(top.locator('.secondary-projection__notice')).toContainText(/anatomy only/i);
  await expect(top.locator('canvas')).toHaveCount(0);
  await top.locator('path').last().hover();
  await page.locator('.region-inspection > summary').click();
  const tooltip = page.locator('.region-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/(Left|Right) hemisphere/);
  await expect(tooltip.locator('.region-tooltip__value')).toBeHidden();
});

test('static-map failures stay isolated from the registered projection frames', async ({ page }) => {
  await page.route('**/static/top.isvg.gz', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.goto('/app/?v=4&secondary=top');

  await expect(page.locator('[data-secondary-panel="top"] .secondary-projection__notice')).toHaveText(
    'Static projection unavailable',
  );
  await expect(page.locator('[data-secondary-panel="top"] .projection-viewport__error')).toContainText('HTTP 503');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
});
