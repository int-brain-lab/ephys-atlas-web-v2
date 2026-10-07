import { expect, test } from '@playwright/test';

test('a continuous smooth wheel gesture keeps navigating while its slice pack loads', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/registered/coronal/11.isvg.gz', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/app/');
    const frame = page.locator('[data-view="coronal"]');
    const renderer = frame.locator('.view-frame__renderer');
    const slider = page.getByLabel('coronal slice');
    await expect(frame).toHaveAttribute('aria-busy', 'false');
    await expect(renderer).toHaveAttribute('data-asset-index', '660');
    const svg = frame.locator('.view-frame__brain-svg');
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    // Browser input uses hit testing; dispatchEvent would bypass the broken CSS.
    await page.mouse.wheel(0, -24);
    await expect(slider).toHaveValue('88');
    await expect(frame).toHaveAttribute('aria-busy', 'true');
    await page.mouse.wheel(0, -8);
    await expect(slider).toHaveValue('90');
    const progress = frame.locator('.operation-status[data-variant="compact"]');
    await expect(progress).toBeVisible();
    const progressBox = (await progress.boundingBox())!;
    await page.mouse.move(progressBox.x + progressBox.width / 2, progressBox.y + progressBox.height / 2);
    await page.mouse.wheel(0, -8);
    await expect(slider).toHaveValue('92');
    await expect(renderer).toHaveAttribute('data-asset-index', '660');
    // Stale geometry must still reject inspection and region selection.
    const path = renderer.locator('path[data-allen-id="-362"]').first();
    await path.dispatchEvent('pointermove', { clientX: box.x + 30, clientY: box.y + 30 });
    await path.dispatchEvent('pointerup');
    await expect(frame.locator('.region-tooltip')).toBeHidden();
    expect(new URL(page.url()).searchParams.has('selected')).toBe(false);
    release();
    await expect(frame).toHaveAttribute('aria-busy', 'false');
    await expect(renderer).toHaveAttribute('data-asset-index', '740');
  } finally { release(); }
});
