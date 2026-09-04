import { expect, test } from '@playwright/test';

test('desktop project and dataset controls disclose edition and exact release context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden-v1');

  const project = page.locator('[data-context-field="project"]');
  const dataset = page.locator('[data-context-field="dataset"]');
  const view = page.locator('[data-context-field="representation"]');
  await expect(project.locator('.context-field__value')).toHaveText('Synthetic development data');
  await expect(project.locator('.context-field__release')).toHaveText('Individual releases');
  await expect(view.locator('.context-field__label')).toHaveText('View');

  await dataset.locator('.context-menu__trigger').click();
  const exactRelease = dataset.getByRole('option', { name: /Synthetic golden-v1/ });
  await expect(exactRelease).toContainText('Development');
  await expect(exactRelease).toContainText('Immutable release ID · golden-v1');
  await page.keyboard.press('Escape');

  const initialHistoryLength = await page.evaluate(() => history.length);
  await project.locator('.context-menu__trigger').click();
  await project.getByRole('option', { name: /Synthetic current edition/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('edition')).toBe('synthetic-current');
  await expect.poll(() => new URL(page.url()).searchParams.get('context')).toBeNull();
  await expect(project.locator('.context-field__release')).toHaveText('Synthetic current edition');

  await project.locator('.context-menu__trigger').click();
  await project.getByRole('option', { name: /Choose individual releases/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('context')).toBe('custom');
  await expect.poll(() => new URL(page.url()).searchParams.get('base_edition')).toBe('synthetic-current');
  await expect(project.locator('.context-field__release'))
    .toHaveText('Individual releases · based on Synthetic current edition');
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength + 2);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('edition')).toBe('synthetic-current');
  await expect(project.locator('.context-field__release')).toHaveText('Synthetic current edition');
});

test('phone Data chooser stages an edition selection and commits one exact history checkpoint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden-v1');

  await expect(page.locator('[data-context-field="project"]')).toBeHidden();
  await expect(page.locator('[data-context-field="dataset"]')).toBeHidden();
  const trigger = page.getByRole('button', { name: /^Data:/ });
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText('Synthetic development data / IBL Ephys Atlas v2 golden fixture');
  await expect(trigger).toContainText('Individual releases / Synthetic golden-v1');

  const initialUrl = page.url();
  const initialHistoryLength = await page.evaluate(() => history.length);
  await trigger.press('ArrowDown');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Choose project');
  const project = dialog.getByRole('button', { name: /Synthetic development data/ });
  await expect(project).toBeFocused();
  await expect(project).toHaveAttribute('aria-current', 'true');
  await project.press('Enter');
  await expect(dialog.getByRole('heading')).toHaveText('Choose version set');
  await expect(page).toHaveURL(initialUrl);

  const back = dialog.getByRole('button', { name: /Projects/ });
  await expect(back).toBeFocused();
  await back.press('Enter');
  await expect(dialog.getByRole('heading')).toHaveText('Choose project');
  await dialog.getByRole('button', { name: /Synthetic development data/ }).click();
  await dialog.getByRole('button', { name: /Synthetic current edition/ }).click();
  await expect(dialog.getByRole('heading')).toHaveText('Choose dataset and exact version');
  await expect(page).toHaveURL(initialUrl);
  await dialog.getByRole('button', { name: /Synthetic golden-v1/ }).click();

  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get('edition')).toBe('synthetic-current');
  await expect.poll(() => new URL(page.url()).searchParams.get('context')).toBeNull();
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
  await expect(trigger).toContainText('Synthetic current edition / Synthetic golden-v1');

  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('Data chooser remains bounded at the phone breakpoint edge', async ({ page }) => {
  await page.setViewportSize({ width: 759, height: 500 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /^Data:/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.getByRole('dialog');
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(759);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 759);
});

test('phone Data chooser announces catalog loading and failure', async ({ page }) => {
  let rejectCatalog: (() => void) | undefined;
  let catalogAttempts = 0;
  const catalogGate = new Promise<void>((resolve) => { rejectCatalog = resolve; });
  await page.route('**/__real-data/catalog.json', async (route) => {
    catalogAttempts += 1;
    if (catalogAttempts > 1) {
      await route.fallback();
      return;
    }
    await catalogGate;
    await route.fulfill({ status: 503, body: 'catalog unavailable' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const trigger = page.getByRole('button', { name: /^Data:/ });
  await expect(trigger).toHaveAttribute('aria-busy', 'true');
  await trigger.click();
  const status = page.getByRole('dialog').getByRole('status');
  await expect(status).toHaveText('Loading projects…');

  rejectCatalog?.();
  await expect(trigger).toHaveAttribute('aria-busy', 'false');
  await expect(status).toContainText('Projects unavailable: HTTP 503');
  await page.getByRole('dialog').getByRole('button', { name: /Retry catalog/ }).click();
  await expect(trigger).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden-v1');
  expect(catalogAttempts).toBe(2);
});

test('invalid edition URL stays visible and offers explicit recovery choices', async ({ page }) => {
  let releaseManifestRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/golden_fixture/golden-v1/manifest.json')) releaseManifestRequests += 1;
  });
  const invalid = '/?v=4&project=synthetic-development&edition=synthetic-current&dataset=golden_fixture&release=missing';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(invalid);
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('missing');
  const initialHistoryLength = await page.evaluate(() => history.length);

  const project = page.locator('[data-context-field="project"]');
  await expect(project.locator('.context-field__release')).toHaveText('Navigation unavailable · open to recover');
  await project.locator('.context-menu__trigger').click();
  const recovery = project.getByRole('group', { name: 'Navigation recovery' });
  await expect(recovery.getByRole('option', { name: /Use catalog default/ })).toBeVisible();
  await expect(recovery.getByRole('option', { name: /Return to edition/ })).toBeVisible();
  await expect(recovery.getByRole('option', { name: /Open exact release as custom/ })).toBeVisible();
  await recovery.getByRole('option', { name: /Return to edition/ }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get('edition')).toBe('synthetic-current');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden-v1');
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toContainText('AP RMS');
  expect(releaseManifestRequests).toBe(1);
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('missing');
  expect(releaseManifestRequests).toBe(1);
  await project.locator('.context-menu__trigger').click();
  await project.getByRole('option', { name: /Use catalog default/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('context')).toBe('custom');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden-v1');

  await page.goBack();
  await page.setViewportSize({ width: 390, height: 844 });
  const data = page.getByRole('button', { name: /^Data:/ });
  await expect(data).toContainText('Navigation unavailable / open to recover');
  await data.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Return to edition/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('unknown navigation identity exposes only catalog-default recovery', async ({ page }) => {
  const invalid = '/?v=4&project=unknown-project&context=custom&dataset=golden_fixture&release=golden-v1';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(invalid);
  await expect(page).toHaveURL(new RegExp('project=unknown-project'));

  const project = page.locator('[data-context-field="project"]');
  await project.locator('.context-menu__trigger').click();
  const recovery = project.getByRole('group', { name: 'Navigation recovery' });
  await expect(recovery.getByRole('option')).toHaveCount(1);
  await expect(recovery.getByRole('option')).toHaveText(/Use catalog default/);
  await recovery.getByRole('option').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe('synthetic-development');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden-v1');
});
