import { expect, test, type Page } from '@playwright/test';
import { seenHelpTourStorageState } from '../../playwright.seen-tour.js';

const region = (page: Page, id: string) => page.locator(`[data-region-button="${id}"]`);
const selection = (page: Page) => new URL(page.url()).searchParams.get('selected');

for (const modifier of ['Control', 'Meta'] as const) {
  test(`${modifier}-click toggles regions while plain clicks replace and remain selected`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/app/');
    await region(page, '-68').click();
    await region(page, '-362').click();
    await expect.poll(() => selection(page)).toBe('-362');
    await expect(region(page, '-68')).toHaveAttribute('aria-pressed', 'false');
    await region(page, '-362').click();
    await expect.poll(() => selection(page)).toBe('-362');
    await region(page, '-68').click({ modifiers: [modifier] });
    await expect.poll(() => selection(page)).toBe('-362,-68');
    await region(page, '-362').click({ modifiers: [modifier] });
    await expect.poll(() => selection(page)).toBe('-68');
    await page.reload();
    await expect(region(page, '-68')).toHaveAttribute('aria-pressed', 'true');
    await region(page, '-68').click({ modifiers: [modifier] });
    await expect.poll(() => selection(page)).toBeNull();
  });
}

test('keyboard selection supports replace, modifier toggle and explicit multiple mode', async ({ page }) => {
  await page.goto('/app/');
  await region(page, '-68').focus();
  await region(page, '-68').press('Enter');
  await region(page, '-362').focus();
  await region(page, '-362').press('Space');
  await expect.poll(() => selection(page)).toBe('-362');
  await region(page, '-68').focus();
  await region(page, '-68').press('Control+Space');
  await expect.poll(() => selection(page)).toBe('-362,-68');
  const mode = page.getByRole('checkbox', { name: 'Select multiple', exact: true });
  await mode.focus();
  await mode.press('Space');
  await expect(mode).toBeChecked();
  await region(page, '-68').focus();
  await region(page, '-68').press('Enter');
  await expect.poll(() => selection(page)).toBe('-362');
  await mode.uncheck();
  await region(page, '-68').focus();
  await region(page, '-68').press('Enter');
  await expect.poll(() => selection(page)).toBe('-68');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => selection(page)).toBeNull();
});

test('linked slices replace or toggle the shared region-list selection', async ({ page }) => {
  await page.goto('/app/');
  await region(page, '-68').click();
  const path = page.locator('[data-view="coronal"] path[data-allen-id="362"]').first();
  await path.dispatchEvent('pointerup');
  await expect.poll(() => selection(page)).toBe('-362');
  await expect(region(page, '-68')).toHaveAttribute('aria-pressed', 'false');
  await region(page, '-68').click();
  await path.dispatchEvent('pointerup', { ctrlKey: true });
  await expect.poll(() => selection(page)).toBe('-68,-362');
  await path.dispatchEvent('pointerup', { metaKey: true });
  await expect.poll(() => selection(page)).toBe('-68');
  await page.getByRole('checkbox', { name: 'Select multiple', exact: true }).check();
  await path.dispatchEvent('pointerup');
  await expect.poll(() => selection(page)).toBe('-68,-362');
});

test('touch users can toggle multiple regions from the Regions drawer', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173', hasTouch: true, viewport: { width: 390, height: 844 },
    storageState: seenHelpTourStorageState('http://127.0.0.1:4173'),
  });
  const page = await context.newPage();
  try {
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Regions', exact: true }).tap();
    const mode = page.getByRole('checkbox', { name: 'Select multiple', exact: true });
    await expect(mode).toBeVisible();
    await mode.tap();
    await region(page, '-68').tap();
    await region(page, '-362').tap();
    await expect.poll(() => selection(page)).toBe('-68,-362');
    await mode.tap();
    await region(page, '-68').tap();
    await expect.poll(() => selection(page)).toBe('-68');
    await page.screenshot({ path: '/tmp/ephys-selection-phone.png' });
  } finally { await context.close(); }
});
