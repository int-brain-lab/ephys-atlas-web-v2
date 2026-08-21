import { expect, test } from '@playwright/test';

const RELEASE_PATH = '/fixtures/ephys_atlas_channels/golden-v0.3/';

test.beforeEach(async ({ page }) => {
  await page.route(`**${RELEASE_PATH}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`${RELEASE_PATH}manifest.json`)) {
      const response = await route.fetch();
      const manifest = await response.json();
      manifest.features.push({ id: 'rms_lf', path: 'features/rms_lf/feature.json' });
      await route.fulfill({ response, json: manifest });
      return;
    }
    if (url.pathname.includes(`${RELEASE_PATH}features/rms_lf/`)) {
      const sourceUrl = url.toString().replace('/features/rms_lf/', '/features/rms_ap/');
      const response = await route.fetch({ url: sourceUrl });
      if (url.pathname.endsWith('/feature.json')) {
        const feature = await response.json();
        feature.id = 'rms_lf';
        feature.label = 'LFP RMS (shortcut fixture)';
        await route.fulfill({ response, json: feature });
      } else {
        await route.fulfill({ response });
      }
      return;
    }
    await route.continue();
  });
});

test('global shortcuts search and cycle the manifest feature catalogue', async ({ page }) => {
  await page.goto('/');

  const featureField = page.locator('[data-context-field="feature"]');
  const featureTrigger = featureField.locator('.context-menu__trigger');
  const featureSearch = featureField.getByLabel('Search features, units, or IDs');
  const shortcutStatus = page.locator('.visually-hidden[role="status"]');
  await expect(featureTrigger).toHaveAttribute('aria-keyshortcuts', '/ Shift+ArrowUp Shift+ArrowDown');
  await expect(featureTrigger).toContainText('AP RMS (golden fixture)');

  await page.keyboard.press('/');
  await expect(featureSearch).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(featureTrigger).toContainText('LFP RMS (shortcut fixture)');
  await expect.poll(() => new URL(page.url()).searchParams.get('feature')).toBe('rms_lf');
  await expect(shortcutStatus).toContainText('Feature 2 of 2: LFP RMS (shortcut fixture)');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(featureTrigger).toContainText('LFP RMS (shortcut fixture)');
  await expect(shortcutStatus).toContainText('Last feature');

  await page.keyboard.press('Shift+ArrowUp');
  await expect(featureTrigger).toContainText('AP RMS (golden fixture)');
  await expect.poll(() => new URL(page.url()).searchParams.get('feature')).toBe('rms_ap');
});

test('shortcuts stay out of text entry and expose an in-product guide', async ({ page }) => {
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
  await expect(featureField.getByLabel('Search features, units, or IDs')).toBeFocused();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: '?', shiftKey: true, bubbles: true, cancelable: true,
  })));
  const guide = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Next feature');
  await expect(guide).toContainText('Search features');

  await page.keyboard.press('Shift+ArrowDown');
  await expect(featureField.locator('.context-menu__trigger')).toContainText('AP RMS (golden fixture)');
  await page.keyboard.press('Escape');
  await expect(guide).not.toBeVisible();

  await page.getByRole('button', { name: 'Shortcuts' }).first().click();
  await expect(guide).toBeVisible();
});
