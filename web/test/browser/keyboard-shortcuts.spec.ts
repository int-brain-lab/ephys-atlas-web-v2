import { expect, test } from '@playwright/test';

test('global shortcuts search and report manifest feature catalogue boundaries', async ({ page }) => {
  await page.goto('/');

  const featureField = page.locator('[data-context-field="feature"]');
  const featureTrigger = featureField.locator('.context-menu__trigger');
  const featureSearch = featureField.getByLabel('Search features…');
  const shortcutStatus = page.locator('.visually-hidden[role="status"]');
  await expect(featureTrigger).toHaveAttribute('aria-keyshortcuts', '/ Shift+ArrowUp Shift+ArrowDown');
  await expect(featureTrigger).toContainText('AP RMS (golden fixture)');

  await page.keyboard.press('/');
  await expect(featureSearch).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(featureTrigger).toContainText('AP RMS (golden fixture)');
  await expect(shortcutStatus).toContainText('Last feature');

  await page.keyboard.press('Shift+ArrowUp');
  await expect(featureTrigger).toContainText('AP RMS (golden fixture)');
  await expect(shortcutStatus).toContainText('First feature');
});

test('shortcuts stay out of text entry and expose the task-first help guide', async ({ page }) => {
  await page.goto('/');

  const featureField = page.locator('[data-context-field="feature"]');
  const regionSearch = page.getByLabel('Search brain regions');
  await regionSearch.fill('VISp');
  await page.keyboard.press('/');
  await page.keyboard.press('[');
  await page.keyboard.press(']');
  await expect(regionSearch).toHaveValue('VISp/[]');
  await expect(featureField.locator('.context-menu__panel')).toHaveAttribute('data-open', 'false');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(featureField.locator('.context-menu__trigger')).toContainText('AP RMS (golden fixture)');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: '/', shiftKey: true, bubbles: true, cancelable: true,
  })));
  await expect(featureField.getByLabel('Search features…')).toBeFocused();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: '?', shiftKey: true, bubbles: true, cancelable: true,
  })));
  const guide = page.getByRole('dialog', { name: 'Help & getting started' });
  await expect(guide).toBeVisible();
  await expect(guide.locator('.help-guide__schematic')).toHaveCount(0);
  await expect(guide.getByRole('heading', { name: 'Quick Start' })).toBeVisible();
  await expect(guide.locator('.help-guide__getting-started ol > li')).toHaveCount(4);
  await expect(guide).toContainText('Choose what to view');
  await expect(guide).toContainText('Move through the brain');
  await expect(guide).toContainText('Inspect a value');
  await expect(guide).toContainText('Interpret and save');
  await expect(guide).toContainText('They do not change the source or downloaded values');

  const mode = guide.locator('.help-guide__current-mode');
  await expect(mode.getByText('Using regional data')).toBeVisible();
  await mode.getByText('Using regional data').click();
  await expect(mode).toContainText('Compare selected regions');

  const concepts = guide.locator('.help-guide__disclosure').filter({ hasText: 'Concepts and terminology' });
  await concepts.getByText('Concepts and terminology').click();
  await expect(concepts).toContainText('Dataset and immutable release');
  await expect(concepts).toContainText('For volume data, it changes the anatomical overlay and region inspection, not the voxel values');
  await expect(concepts).toContainText('Check Info before interpreting or citing a feature');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(featureField.locator('.context-menu__trigger')).toContainText('AP RMS (golden fixture)');
  await page.keyboard.press('Escape');
  await expect(guide).not.toBeVisible();

  await page.getByRole('button', { name: 'Help' }).first().click();
  await expect(guide).toBeVisible();
  await guide.getByText('About and credits').click();
  const iblCoreLink = guide.getByRole('link', { name: 'IBL Core (opens in a new tab)' });
  await expect(iblCoreLink).toHaveAttribute('href', 'https://iblcore.org/');
  await expect(guide).toContainText('Cyrille Rossant, Mayo Faulkner, Olivier Winter, Gaelle Chapuis, and Dan Birman');
  await expect(guide).toContainText('Paper and public data-release links will be added when they are available');
  await guide.getByText('Keyboard shortcuts').click();
  await expect(guide).toContainText('next or previous feature');
  await expect(guide).toContainText('search features');
  await expect(guide).toContainText('toggle the Regions or Settings panel');
});

test('help guide stays readable within a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.app-header__overflow-trigger').click();
  await page.locator('.app-header__overflow-menu').getByRole('button', { name: 'Help' }).click();

  const guide = page.getByRole('dialog', { name: 'Help & getting started' });
  await expect(guide).toBeVisible();
  const bounds = await guide.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await expect(guide.locator('.help-guide__getting-started ol > li')).toHaveCount(4);
  await expect(guide.locator('.help-guide__markdown').first()).toHaveCSS('font-size', '14px');
});

test('help title stays above the Markdown guide while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto('/');
  await page.keyboard.press('?');

  const guide = page.getByRole('dialog', { name: 'Help & getting started' });
  await expect(guide).toBeVisible();
  const layering = await guide.evaluate(async (dialog) => {
    const header = dialog.querySelector<HTMLElement>('.info-dialog__header');
    if (!header) return null;
    dialog.scrollTop = 240;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const headerBounds = header.getBoundingClientRect();
    const point = {
      x: headerBounds.left + headerBounds.width / 2,
      y: headerBounds.top + headerBounds.height / 2,
    };
    return {
      scrollTop: dialog.scrollTop,
      headerIsOnTop: header.contains(document.elementFromPoint(point.x, point.y)),
    };
  });

  expect(layering).not.toBeNull();
  expect(layering!.scrollTop).toBeGreaterThan(0);
  expect(layering!.headerIsOnTop).toBe(true);
});

test('help guidance follows the active representation', async ({ page }) => {
  await page.goto('/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25');
  await page.getByRole('button', { name: 'Help' }).first().click();

  const guide = page.getByRole('dialog', { name: 'Help & getting started' });
  const mode = guide.locator('.help-guide__current-mode');
  await expect(mode.getByText('Using volume data')).toBeVisible();
  await mode.getByText('Using volume data').click();
  await expect(mode).toContainText('Inspect voxels');
  await expect(mode).toContainText('Outside and missing voxels are not treated as scientific zero values');
  await expect(mode).toContainText('They do not change the volume grid or voxel values');
  await expect(mode).not.toContainText('Compare selected regions');
});
