import { expect, test } from '@playwright/test';

test('real native pack opens and switches to D042 without losing explode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const manifests: Record<string, any>[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/__local-assets/mesh/') && response.url().endsWith('/manifest.json')) manifests.push(await response.json());
  });
  await page.goto('/');
  await expect(page.locator('#scene')).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(page.locator('#variant')).toHaveValue('native');
  await expect(page.locator('#status')).toContainText('native-full');
  await expect(page.locator('#review-component option')).toHaveCount(12);
  await expect.poll(() => manifests.length).toBeGreaterThan(0);
  expect(manifests[0].geometry_policy).toBe('native-components');
  expect(manifests[0].purpose).toBe('review-only');
  expect(manifests[0].components.length).toBe(1140);
  expect(manifests[0].lods[0].triangle_count).toBe(966645);
  await page.locator('#side-colours').check();
  await expect(page.locator('#scene')).toHaveAttribute('data-geometry-uploads', '1');
  await page.locator('#explode').fill('0.5');
  await page.locator('#variant').selectOption('d042');
  await expect(page.locator('#scene')).toHaveAttribute('data-lod', 'compiled-full');
  await expect(page.locator('#scene')).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(page.locator('#scene')).toHaveAttribute('data-explode', '0.5');
  await expect(page.locator('#side-colours')).toBeChecked();
  await page.locator('#variant').selectOption('native');
  await expect(page.locator('#scene')).toHaveAttribute('data-lod', 'native-full');
  await expect(page.locator('#scene')).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(page.locator('#scene')).toHaveAttribute('data-explode', '0.5');
  expect(errors).toEqual([]);
});

test('all twelve real movement exceptions can be focused and compared', async ({ page }) => {
  await page.goto('/?variant=native');
  const scene = page.locator('#scene');
  await expect(scene).toHaveAttribute('data-scene3d-state', 'ready');
  await page.locator('#show-context').uncheck();
  for (let index = 0; index < 12; index += 1) {
    await page.locator('#review-component').selectOption(String(index));
    await expect(page.locator('#review-detail')).toContainText('unreviewed');
    await page.locator('#explode').fill(index % 2 ? '0.5' : '0');
    await expect(scene).toHaveAttribute('data-geometry-uploads', '1');
    const pixels = await scene.locator('canvas').screenshot();
    const visiblePixels = await page.evaluate(async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, image.width, image.height).data;
      let count = 0;
      for (let offset = 0; offset < rgba.length; offset += 4) {
        if (Math.abs(rgba[offset] - 9) + Math.abs(rgba[offset + 1] - 20) + Math.abs(rgba[offset + 2] - 30) > 40) count += 1;
      }
      return count;
    }, pixels.toString('base64'));
    expect(visiblePixels, `component ${index} stays visible while moving`).toBeGreaterThan(100);
  }
  await page.locator('#variant').selectOption('d042');
  await expect(scene).toHaveAttribute('data-lod', 'compiled-full');
  await page.locator('#variant').selectOption('native');
  await expect(scene).toHaveAttribute('data-lod', 'native-full');
  await expect(page.locator('#review-component')).toHaveValue('11');
});
