import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const archive = resolve(process.cwd(), '../fixtures/golden-v1.ibl-ephys-atlas.zip');

async function mockAnalytics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Window & { __analyticsCalls: unknown[] }).__analyticsCalls = [];
  });
  await page.route('**/src/analytics.ts*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: `
      export function initializeAnalytics() {}
      const seen = new Set();
      export function trackOnce(event, ...details) {
        if (seen.has(event)) return;
        seen.add(event);
        window.__analyticsCalls.push(details.length ? [event, ...details] : event);
      }
    `,
  }));
}

async function events(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const calls = (window as Window & { __analyticsCalls: unknown[] }).__analyticsCalls;
    return calls.map((call) => typeof call === 'string' ? call : String((call as unknown[])[0]));
  });
}

test('initial data load is recorded once, while hydrated state and navigation are not exploration', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/app/?v=4&dataset=golden_fixture&release=golden-v1&feature=rms_ap&selected=-68,-362');
  await expect(page.locator('[data-region-button="-68"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => events(page)).toContain('data_loaded');
  expect((await events(page)).filter((event) => event === 'data_loaded')).toHaveLength(1);
  expect(await events(page)).not.toContain('exploration_started');

  const originalCursor = new URL(page.url()).searchParams.get('cursor');
  await page.getByLabel('coronal slice').fill('87');
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).not.toBe(originalCursor);
  expect(await events(page)).not.toContain('exploration_started');

  await page.locator('[data-region-button="-315"]').click({ modifiers: ['Control'] });
  expect(await events(page)).not.toContain('exploration_started');
  await page.getByLabel('Search brain regions').fill('CA1');
  await page.locator('[data-region-button="-382"]').click({ modifiers: ['Control'] });
  await expect.poll(() => events(page)).toContain('exploration_started');
  await page.getByLabel('Search brain regions').fill('');
  await page.locator('[data-region-button="-362"]').click({ modifiers: ['Control'] });
  await expect.poll(async () => (await events(page)).filter((event) => event === 'exploration_started')).toHaveLength(1);
});

test('a failed scientific feature payload does not count as data loaded', async ({ page }) => {
  await mockAnalytics(page);
  await page.route('**/features/rms_ap/allen.values.f32', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/app/');

  await expect(page.locator('.region-statistic-domain')).toContainText('Regional values unavailable');
  await expect(page.locator('.distribution-band__surface .operation-status[data-state="error"]')).toBeVisible();
  expect(await events(page)).not.toContain('data_loaded');
});

test('comparison usage requires an opened table with at least two selected regions', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/app/');
  await expect.poll(() => events(page)).toContain('data_loaded');

  const openComparison = page.getByRole('button', { name: 'Open selected-region comparison' });
  await expect(openComparison).toBeDisabled();
  expect(await events(page)).not.toContain('comparison_used');

  const multiple = page.getByRole('button', { name: 'Select multiple', exact: true });
  await multiple.click();
  await page.locator('[data-region-button="-68"]').click();
  await page.locator('[data-region-button="-362"]').click();
  await expect(page.locator('.regional-comparison__table')).toBeHidden();
  expect(await events(page)).not.toContain('comparison_used');

  await page.getByRole('button', { name: /Open comparison for 2 selected regions/ }).click();
  await expect(page.locator('.regional-comparison__table')).toBeVisible();
  await expect.poll(() => events(page)).toContain('comparison_used');
  await page.getByRole('button', { name: /Minimize comparison for 2 selected regions/ }).click();
  await page.getByRole('button', { name: /Open comparison for 2 selected regions/ }).click();
  await expect.poll(async () => (await events(page)).filter((event) => event === 'comparison_used')).toHaveLength(1);
});

test('opening mobile comparison for hydrated volume selections is not regional comparison use', async ({ page }) => {
  await mockAnalytics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/?v=4&repr=volume&selected=-68,-362&cursor=25,25,25');
  await expect.poll(() => events(page)).toContain('data_loaded');
  await expect(page.locator('.analysis-panel')).toHaveAttribute('data-empty', 'false');
  expect(await events(page)).not.toContain('comparison_used');

  await page.getByRole('button', { name: /Open comparison for 2 selected regions/ }).click();
  const comparison = page.locator('.analysis-dialog');
  await expect(comparison).toHaveAttribute('open', '');
  await expect(comparison).toHaveAttribute('aria-modal', 'true');
  await expect(comparison.locator('.regional-comparison__table')).toHaveCount(0);
  expect(await events(page)).not.toContain('comparison_used');
});

test('share and download events follow successful clipboard and artifact actions', async ({ page }) => {
  await mockAnalytics(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('clipboard unavailable'); } },
    });
  });
  await page.goto('/app/?v=4&feature=rms_ap&stat=median');
  await expect.poll(() => events(page)).toContain('data_loaded');
  const actions = page.locator('.app-header__desktop-actions');

  await actions.getByRole('button', { name: 'Share' }).click();
  await expect(actions.getByRole('button', { name: 'Share' })).toHaveAttribute('title', 'Could not copy link');
  expect(await events(page)).not.toContain('share_copied');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await actions.getByRole('button', { name: 'Share' }).click();
  await expect(actions.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect.poll(() => events(page)).toContain('share_copied');
  expect((await events(page)).filter((event) => event === 'share_copied')).toHaveLength(1);

  await actions.getByRole('button', { name: 'Download' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download feature data' });
  await expect(dialog).toBeVisible();
  expect(await events(page)).not.toContain('download_started');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Export Allen Median as CSV/ }).click();
  expect((await downloadPromise).suggestedFilename()).toContain('rms_ap');
  await expect.poll(() => events(page)).toContain('download_started');
});

test('local import is recorded only after successful validation and storage', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/app/');
  await expect.poll(() => events(page)).toContain('data_loaded');
  const dataset = page.locator('[data-context-field="data"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Import local dataset…' }).click();
  await page.locator('.local-import__input').setInputFiles(archive);
  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await expect(dialog.getByRole('status')).toContainText('Validation complete');
  expect(await events(page)).not.toContain('local_imported');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => events(page)).toContain('local_imported');
  expect((await events(page)).filter((event) => event === 'local_imported')).toHaveLength(1);
});
