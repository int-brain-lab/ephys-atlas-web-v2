import { expect, test } from '@playwright/test';

for (const width of [1920, 1280, 900, 390]) {
  test(`region inspection stays outside anatomy and restores selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/?v=4&selected=-477&autoSlice=0');
    const inspector = page.locator('.region-inspection');
    await expect(inspector).toHaveAttribute('data-source', 'selected');
    await expect(inspector.locator('.region-tooltip')).toHaveAttribute('data-region-id', '-477');
    await expect(inspector).toHaveAttribute('data-placement', width >= 1480 ? 'docked' : 'strip');
    const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
    await path.dispatchEvent('pointermove', { clientX: 100, clientY: 100 });
    await expect(inspector).toHaveAttribute('data-source', 'hover');
    await expect(inspector.locator('.region-tooltip')).toHaveAttribute('data-region-id', '-362');
    const viewport = await page.locator('[data-view="coronal"] .view-frame__viewport').boundingBox();
    const bounds = await inspector.boundingBox();
    if (width >= 1480) expect(bounds!.x).toBeGreaterThanOrEqual(viewport!.x + viewport!.width);
    else expect(bounds!.y).toBeGreaterThanOrEqual(viewport!.y + viewport!.height);
    await page.locator('[data-view="coronal"] .view-frame__slice-figure').dispatchEvent('pointerleave');
    await expect(inspector).toHaveAttribute('data-source', 'selected');
    await expect(inspector.locator('.region-tooltip')).toHaveAttribute('data-region-id', '-477');
    if (width < 1480) {
      await expect(inspector.locator('.region-tooltip')).toBeHidden();
      await inspector.locator('summary').click();
      await expect(inspector.locator('.region-tooltip')).toBeVisible();
      if (width < 1100) {
        await page.getByRole('button', { name: 'Sagittal', exact: true }).click();
        await expect(page.locator('[data-view="sagittal"] .region-inspection')).toBeVisible();
      }
    }
  });
}

test('collapsed sidebar, maximize and resize retain accessible inspection', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/app/?v=4&selected=-362');
  const inspector = page.locator('.region-inspection');
  await expect(inspector).toHaveAttribute('data-placement', 'docked');
  await page.getByRole('button', { name: 'Hide Visualization settings' }).click();
  await expect(inspector).toHaveAttribute('data-placement', 'strip');
  await expect(page.locator('[data-view="coronal"] .region-inspection')).toBeVisible();
  await page.getByRole('button', { name: 'Show Visualization settings' }).click();
  await expect(inspector).toHaveAttribute('data-placement', 'docked');
  await page.getByRole('button', { name: 'Maximize sagittal view' }).click();
  await expect(page.locator('[data-view="sagittal"] .region-inspection')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveAttribute('data-placement', 'docked');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(inspector).toHaveAttribute('data-placement', 'strip');
  await expect(inspector).toHaveAttribute('data-source', 'selected');
});

test('touch selection supplies expandable information without hover', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/app/?v=4&autoSlice=0');
  await page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first().dispatchEvent('pointerup', {
    pointerType: 'touch', button: 0,
  });
  const inspector = page.locator('.region-inspection');
  await expect(inspector).toHaveAttribute('data-source', 'selected');
  await inspector.locator('summary').tap();
  await expect(inspector.locator('.region-tooltip')).toContainText('Mediodorsal nucleus');
  await context.close();
});

test('last inspection remains readable and is cleared when its statistic changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  const inspector = page.locator('.region-inspection');
  await page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first().hover();
  await expect(inspector).toHaveAttribute('data-source', 'hover');
  await page.mouse.move(10, 10);
  await expect(inspector).toHaveAttribute('data-source', 'recent');
  await inspector.locator('summary').click();
  await expect(inspector.locator('.region-tooltip')).toContainText('Mediodorsal nucleus');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Regional statistic', { exact: true }).selectOption('median');
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveAttribute('data-source', 'empty');
  await expect(inspector.locator('.region-tooltip')).toBeHidden();
});

test('region info stays above settings at a fixed height and restores every selection', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/app/?v=4&selected=-362,-477&autoSlice=0');
  const inspector = page.locator('.region-inspection');
  const settingsHeader = page.locator('.settings-pane > .panel__header');
  await expect(inspector.locator('.region-inspection__selection')).toHaveCount(2);
  await expect(inspector.locator('summary')).toContainText('2 regions selected');
  const original = await settingsHeader.boundingBox();
  const bounds = await inspector.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(original!.y);
  await page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first().hover();
  await expect(inspector).toHaveAttribute('data-source', 'hover');
  await expect(inspector.locator('.region-inspection__selection')).toHaveCount(0);
  expect((await settingsHeader.boundingBox())!.y).toBe(original!.y);
  expect((await inspector.boundingBox())!.height).toBe(bounds!.height);
  await expect(page.locator('.region-hover-acronym')).toHaveText('MD');
  await expect(page.locator('.region-hover-acronym')).toHaveCSS('pointer-events', 'none');
  await page.mouse.move(10, 10);
  await expect(inspector.locator('.region-inspection__selection')).toHaveCount(2);
  await expect(page.locator('.region-hover-acronym')).toBeHidden();
});

test('long selected-region lists scroll inside the fixed inspection card', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/app/?v=4&autoSlice=0');
  await expect(page.locator('.region-row')).toHaveCount(874);
  const ids = await page.locator('.region-row').evaluateAll(nodes => nodes.slice(0, 20).map(node => (node as HTMLElement).dataset.regionId!));
  await page.goto(`/app/?v=4&autoSlice=0&selected=${ids.join(',')}`);
  const card = page.locator('.region-tooltip');
  await expect(card.locator('.region-inspection__selection')).toHaveCount(20);
  const scrolling = await card.evaluate(node => ({ height: node.clientHeight, content: node.scrollHeight,
    overflow: getComputedStyle(node).overflowY }));
  expect(scrolling.content).toBeGreaterThan(scrolling.height);
  expect(scrolling.overflow).toBe('auto');
  await card.evaluate(node => { node.scrollTop = node.scrollHeight; });
  expect(await card.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
});

test('the right sidebar hide arrow stays at its top edge above the settings heading', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/app/?v=4&selected=-362');
  const sidebar = await page.locator('.settings-pane').boundingBox();
  const arrow = page.getByRole('button', { name: 'Hide Visualization settings' });
  const bounds = await arrow.boundingBox();
  expect(bounds!.y - sidebar!.y).toBeLessThan(12);
  const heading = await page.locator('.settings-pane > .panel__header').boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(heading!.y);
  await arrow.click();
  const restore = page.getByRole('button', { name: 'Show Visualization settings' });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(arrow).toBeVisible();
});

test('hover acronyms stay inside anatomy and disappear when the pointer reaches a header', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/app/');
  const path = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await path.hover();
  const label = page.locator('.region-hover-acronym');
  await expect(label).toBeVisible();
  const viewport = await page.locator('[data-view="coronal"] .view-frame__viewport').boundingBox();
  const bounds = await label.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(viewport!.x);
  expect(bounds!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
  await page.getByRole('button', { name: 'Maximize coronal view' }).hover();
  await expect(label).toBeHidden();
  await expect(page.getByRole('button', { name: 'Hide Visualization settings' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('moving inspection between desktop views keeps anatomy stationary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&secondary=top');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');
  const coronal = page.locator('[data-view="coronal"] .view-frame__viewport');
  const secondary = page.locator('.secondary-view__body');
  const before = { coronal: await coronal.boundingBox(), secondary: await secondary.boundingBox() };
  await page.locator('[data-secondary-panel="top"] path.atlas-region').last().hover();
  await expect(page.locator('.secondary-view > .region-inspection')).toBeVisible();
  expect(await coronal.boundingBox()).toEqual(before.coronal);
  expect(await secondary.boundingBox()).toEqual(before.secondary);
});
