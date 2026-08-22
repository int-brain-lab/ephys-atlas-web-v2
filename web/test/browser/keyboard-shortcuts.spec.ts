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

test('shortcuts stay out of text entry and expose the concise help guide', async ({ page }) => {
  await page.goto('/');

  const featureField = page.locator('[data-context-field="feature"]');
  const regionSearch = page.getByLabel('Search brain regions');
  await regionSearch.fill('VISp');
  await page.keyboard.press('/');
  await expect(regionSearch).toHaveValue('VISp/');
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
  const guide = page.getByRole('dialog', { name: 'Using the Ephys Atlas' });
  await expect(guide).toBeVisible();
  await expect(guide.locator('.help-guide__schematic')).toBeVisible();
  await expect(guide.locator('.help-schematic__callout')).toHaveCount(5);
  await expect(guide.locator('.help-schematic__slice-control')).toHaveCount(3);
  const sliceControlWidths = await guide.locator('.help-schematic__slice-control').evaluateAll((controls) => (
    controls.map((control) => control.getBoundingClientRect().width)
  ));
  expect(Math.max(...sliceControlWidths) - Math.min(...sliceControlWidths)).toBeLessThanOrEqual(1);
  for (const projection of await guide.locator('.help-schematic__view i').all()) {
    await expect(projection).toHaveCSS('transform', 'none');
  }
  await expect(guide.locator('.help-guide__section')).toHaveCount(5);
  await expect(guide).toContainText('Data and feature');
  await expect(guide).toContainText('Read distributions and comparisons');
  await expect(guide).toContainText('Consult Info before interpreting or citing them');
  const dataSection = guide.locator('.help-guide__section').filter({ hasText: 'Data and feature' });
  await dataSection.getByText('Data and feature').click();
  await expect(dataSection).toContainText('Parcellation');
  await expect(dataSection).toContainText('changes the regions and their summaries, not only their labels');
  await expect(dataSection).toContainText('The observations included by the release’s scientific recipe');
  const visualizationSection = guide.locator('.help-guide__section').filter({ hasText: 'Set the visualization' });
  await visualizationSection.getByText('Set the visualization').click();
  await expect(visualizationSection).toHaveAttribute('open', '');
  await expect(visualizationSection).toContainText('not the underlying or downloaded values');
  const distributionSection = guide.locator('.help-guide__section').filter({ hasText: 'Read distributions and comparisons' });
  await distributionSection.getByText('Read distributions and comparisons').click();
  await expect(distributionSection).toContainText('normalized independently');
  await expect(distributionSection).toContainText('sample counts separately');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(featureField.locator('.context-menu__trigger')).toContainText('AP RMS (golden fixture)');
  await page.keyboard.press('Escape');
  await expect(guide).not.toBeVisible();

  await page.getByRole('button', { name: 'Help' }).first().click();
  await expect(guide).toBeVisible();
  await guide.getByText('About & credits').click();
  const iblCoreLink = guide.getByRole('link', { name: 'IBL Core website (opens in a new tab)' });
  await expect(iblCoreLink).toHaveAttribute('href', 'https://iblcore.org/');
  await expect(guide).toContainText('Cyrille Rossant, Mayo Faulkner, Olivier Winter, Gaelle Chapuis, and Dan Birman');
  await expect(guide).toContainText('Paper — forthcoming');
  await expect(guide).toContainText('Data release — forthcoming');
  await expect(guide.getByRole('link', { name: /Paper|Data release/ })).toHaveCount(0);
  await guide.getByText('Keyboard shortcuts').click();
  await expect(guide).toContainText('Next feature');
  await expect(guide).toContainText('Search features');
});

test('help guide stays readable within a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.app-header__overflow-trigger').click();
  await page.locator('.app-header__overflow-menu').getByRole('button', { name: 'Help' }).click();

  const guide = page.getByRole('dialog', { name: 'Using the Ephys Atlas' });
  await expect(guide).toBeVisible();
  const bounds = await guide.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await expect(guide.locator('.help-schematic__callout')).toHaveCount(5);
  await expect(guide.locator('.help-guide__section')).toHaveCount(5);
});

test('schematic callouts stay behind the sticky help title while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto('/');
  await page.keyboard.press('?');

  const guide = page.getByRole('dialog', { name: 'Using the Ephys Atlas' });
  await expect(guide).toBeVisible();
  const layering = await guide.evaluate(async (dialog) => {
    const header = dialog.querySelector<HTMLElement>('.info-dialog__header');
    const callout = dialog.querySelector<HTMLElement>('.help-schematic__regions .help-schematic__callout');
    if (!header || !callout) return null;
    const initialCallout = callout.getBoundingClientRect();
    const initialHeader = header.getBoundingClientRect();
    dialog.scrollTop += initialCallout.top - (initialHeader.top + initialHeader.height / 2);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const calloutBounds = callout.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const point = {
      x: calloutBounds.left + calloutBounds.width / 2,
      y: calloutBounds.top + calloutBounds.height / 2,
    };
    return {
      scrollTop: dialog.scrollTop,
      overlaps: point.y >= headerBounds.top && point.y <= headerBounds.bottom,
      headerIsOnTop: header.contains(document.elementFromPoint(point.x, point.y)),
    };
  });

  expect(layering).not.toBeNull();
  expect(layering!.scrollTop).toBeGreaterThan(0);
  expect(layering!.overlaps).toBe(true);
  expect(layering!.headerIsOnTop).toBe(true);
});
