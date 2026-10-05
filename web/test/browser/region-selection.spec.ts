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
  const mode = page.getByRole('button', { name: 'Select multiple', exact: true });
  await mode.focus();
  await mode.press('Space');
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await region(page, '-68').focus();
  await region(page, '-68').press('Enter');
  await expect.poll(() => selection(page)).toBe('-362');
  await mode.click();
  await region(page, '-68').focus();
  await region(page, '-68').press('Enter');
  await expect.poll(() => selection(page)).toBe('-68');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => selection(page)).toBeNull();
});

test('linked slices replace or toggle the shared region-list selection', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Auto-slice', exact: true }).click();
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
  await page.getByRole('button', { name: 'Select multiple', exact: true }).click();
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
    const mode = page.getByRole('button', { name: 'Select multiple', exact: true });
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

test('compact region toggles explain their state on hover and focus without widening a narrow pane', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');
  const auto = page.getByRole('button', { name: 'Auto-slice', exact: true });
  const multiple = page.getByRole('button', { name: 'Select multiple', exact: true });
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await expect(multiple).toHaveAttribute('aria-pressed', 'false');
  await auto.focus();
  await expect(page.locator('#auto-slice-hint')).toBeVisible();
  await expect(page.locator('#auto-slice-hint')).toContainText('Click to keep slices fixed');
  await auto.press('Escape');
  await expect(page.locator('#auto-slice-hint')).toBeHidden();
  await auto.press('Space');
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await multiple.hover();
  await expect(page.locator('#multi-selection-hint')).toBeVisible();
  await expect(page.locator('#multi-selection-hint')).toContainText('Ctrl/Cmd-click');
  await multiple.click();
  await expect(multiple).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#multi-selection-hint')).toContainText('Click to select one region at a time');

  const order = page.getByRole('button', { name: /Region order:/ });
  await order.click();
  await expect(page.getByRole('button', { name: 'Collapse all regions' })).toBeHidden();
  await expect(auto).toBeVisible();
  await expect(multiple).toBeVisible();
  await order.click();
  await order.click();
  await page.locator('.region-search').evaluate((element) => {
    element.style.width = '240px';
    element.style.boxSizing = 'border-box';
  });
  const meta = page.locator('.region-search__meta');
  const bounds = await meta.boundingBox();
  expect(bounds).not.toBeNull();
  for (const control of [auto, multiple, order, page.getByRole('button', { name: 'Collapse all regions' }), page.getByRole('button', { name: 'Expand all regions' })]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
  }
});
