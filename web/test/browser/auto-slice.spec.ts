import { expect, test, type Page } from '@playwright/test';

const region = (page: Page, id: string) => page.locator(`[data-region-button="${id}"]`);
const cursor = (page: Page) => new URL(page.url()).searchParams.get('cursor');
const autoSlice = (page: Page) => page.getByRole('button', { name: 'Auto-slice', exact: true });
const status = (page: Page) => page.locator('.region-auto-slice-status');

async function centeredRegion(page: Page, id: string, mapping = 'allen') {
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    const view = page.getByRole('region', { name: `${axis} view`, exact: true });
    await expect(view).toHaveAttribute('data-state', 'ready');
    await expect.poll(() => view.evaluate((frame, { id, mapping }) => {
      const lines = [...frame.querySelectorAll<SVGLineElement>('.slice-guide')];
      const vertical = lines.find(line => line.x1.baseVal.value === line.x2.baseVal.value);
      const horizontal = lines.find(line => line.y1.baseVal.value === line.y2.baseVal.value);
      if (!vertical || !horizontal) return false;
      const point = new DOMPoint(vertical.x1.baseVal.value, horizontal.y1.baseVal.value);
      return [...frame.querySelectorAll<SVGPathElement>(`path[data-${mapping}-id="-${id}"]`)]
        .some(path => path.isPointInFill(point));
    }, { id, mapping })).toBe(true);
  }
}

async function delayAnchorReads(page: Page, delay: number) {
  await page.route('**/navigation/allen.bin*', async route => {
    if (route.request().resourceType() === 'fetch') await new Promise(resolve => setTimeout(resolve, delay));
    await route.continue();
  });
}

test('auto-slice centers selected regions and disabled state survives reload', async ({ page }) => {
  await page.goto('/app/?v=4&cursor=-5399,4000,-668');
  const toggle = autoSlice(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.focus();
  await expect(page.locator('#auto-slice-hint')).toContainText('keep slices fixed');
  await region(page, '-68').click();
  await centeredRegion(page, '68');
  await expect.poll(() => cursor(page)).toBe('-1059,3470,-2398');
  const positioned = cursor(page);
  await toggle.click();
  await region(page, '-362').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  expect(cursor(page)).toBe(positioned);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(cursor(page)).toBe(positioned);
  await toggle.click();
  expect(cursor(page)).toBe(positioned);
  await region(page, '-362').press('Enter');
  await centeredRegion(page, '362');
});

test('HATA uses an interior center independent of starting slices, preserving explicit URLs on load', async ({ page }) => {
  await page.goto('/app/?v=4&colors=anatomy&parcel=allen&cursor=-2879,-3600,-5358&selected=-589508447');
  await page.locator('.region-search__input').fill('HATA');
  await expect(region(page, '-589508447')).toBeVisible();
  expect(cursor(page)).toBe('-2879,-3600,-5358');
  await region(page, '-589508447').click();
  await expect.poll(() => cursor(page)).toBe('-2689,-3390,-5548');
  await centeredRegion(page, '589508447');
  await page.screenshot({ path: '/tmp/ephys-centered-hata.png' });
  await page.goto('/app/?v=4&colors=anatomy&parcel=allen&cursor=-5399,4000,-668');
  await page.locator('.region-search__input').fill('HATA');
  await region(page, '-589508447').click();
  await expect.poll(() => cursor(page)).toBe('-2689,-3390,-5548');
});

test('turning auto-slice off cancels pending index reads without moving slices', async ({ page }) => {
  await delayAnchorReads(page, 400);
  await page.goto('/app/?v=4&cursor=-5399,4000,-668');
  await region(page, '-68').click();
  await expect(status(page)).toHaveText('Finding slices for the selected region…');
  await autoSlice(page).click();
  const fixed = cursor(page);
  await page.waitForTimeout(600);
  expect(cursor(page)).toBe(fixed);
  await expect(status(page)).toHaveText('');
});

test('manual navigation cancels lookup and a newer selection wins', async ({ page }) => {
  await delayAnchorReads(page, 400);
  await page.goto('/app/?v=4&cursor=-5399,4000,-668');
  await region(page, '-68').click();
  await expect(status(page)).toHaveText('Finding slices for the selected region…');
  const slider = page.getByLabel('coronal slice');
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(status(page)).toHaveText('');
  await expect.poll(() => cursor(page)).not.toBe('-5399,4000,-668');
  const manual = cursor(page);
  await page.waitForTimeout(500);
  expect(cursor(page)).toBe(manual);
  await region(page, '-68').click();
  await region(page, '-362').click();
  await centeredRegion(page, '362');
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe('-362');
  await expect.poll(() => cursor(page)).toBe('-499,-1360,-3588');
});

test('invalid index bytes leave the cursor fixed, show retry help and reselect successfully retries', async ({ page }) => {
  let broken = true;
  await page.route('**/navigation/allen.bin*', async route => {
    if (broken && route.request().resourceType() === 'fetch') await route.fulfill({ body: 'corrupt', contentType: 'application/octet-stream' });
    else await route.continue();
  });
  await page.goto('/app/?v=4&cursor=-5399,4000,-668');
  await region(page, '-68').click();
  await expect(status(page)).toContainText('Select the region again to retry');
  expect(cursor(page)).toBe('-5399,4000,-668');
  broken = false;
  await region(page, '-68').click();
  await centeredRegion(page, '68');
});
