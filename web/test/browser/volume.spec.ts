import { expect, test } from '@playwright/test';

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
  }

  await expect(page.locator('[data-view="coronal"] canvas')).toHaveJSProperty('width', 6);
  await expect(page.locator('[data-view="coronal"] canvas')).toHaveJSProperty('height', 4);
  await expect(page.locator('[data-view="sagittal"] canvas')).toHaveJSProperty('width', 8);
  await expect(page.locator('[data-view="sagittal"] canvas')).toHaveJSProperty('height', 4);
  await expect(page.locator('[data-view="horizontal"] canvas')).toHaveJSProperty('width', 6);
  await expect(page.locator('[data-view="horizontal"] canvas')).toHaveJSProperty('height', 8);
});

test('an out-of-grid world cursor fails explicitly without fetching a clamped edge plane', async ({ page }) => {
  const chunkRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/volume/chunks/')) chunkRequests.push(request.url());
  });
  await page.goto('/?v=4&feature=rms_ap&repr=volume');

  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const frame = page.locator(`[data-view="${axis}"]`);
    await expect(frame).toHaveAttribute('data-state', 'error');
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
});
