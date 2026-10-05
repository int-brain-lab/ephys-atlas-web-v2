import { expect, test } from '@playwright/test';

for (const width of [1280, 768, 390]) {
  test(`slice loading stays visible over retained pixels at ${width}px`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/registered/coronal/11.isvg.gz', async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/app/');
      const frame = page.locator('[data-view="coronal"]');
      const renderer = frame.locator('.view-frame__renderer');
      await expect(renderer).toHaveAttribute('data-asset-index', '660');
      await page.getByLabel('coronal slice').fill('88');
      const status = frame.locator('.operation-status[data-variant="compact"]');
      await expect(status).toBeVisible();
      await expect(status).toContainText('Loading slice…');
      await expect(status).toContainText('Showing the previous slice');
      const announcement = page.locator('.operation-status__live').filter({ hasText: 'Loading slice…' });
      await expect(announcement).toHaveCount(1);
      expect(await announcement.evaluate((node) => node.closest('[aria-busy="true"]'))).toBeNull();
      await expect(renderer).toHaveAttribute('data-asset-index', '660');
      await expect(renderer).toHaveCSS('pointer-events', 'auto');
      const box = (await status.boundingBox())!;
      const frameBox = (await frame.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(frameBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(status.locator('.operation-status__spinner')).toHaveCSS('animation-name', 'none');
      release();
      await expect(renderer).toHaveAttribute('data-asset-index', '708');
      await expect(status).toBeHidden();
      await expect(renderer).toHaveCSS('pointer-events', 'auto');
    } finally {
      release();
    }
  });
}

test('static map loading and Retry remain local to the map', async ({ page }) => {
  let release!: () => void;
  let requests = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/static/top.isvg.gz', async (route) => {
    requests += 1;
    if (requests === 1) {
      await gate;
      await route.fulfill({ status: 503, body: 'offline' });
    } else await route.continue();
  });
  try {
    await page.goto('/app/?v=4&secondary=top');
    const map = page.locator('[data-secondary-panel="top"]');
    const status = map.locator('.operation-status[data-variant="centered"]');
    await expect(status).toContainText('Loading map…');
    await expect(status.locator('.operation-status__spinner')).toBeVisible();
    await expect(map).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
    release();
    await expect(status).toContainText('Couldn’t load this map');
    await expect(map).toHaveAttribute('aria-busy', 'false');
    await status.getByRole('button', { name: 'Retry' }).click();
    await expect(map.locator('path')).toHaveCount(114);
    await expect(status).toBeHidden();
    await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
    expect(requests).toBe(2);
  } finally { release(); }
});

test('artifact download pending and retry stay in the dialog across view updates', async ({ page }) => {
  let release!: () => void;
  let requests = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/features/rms_ap/rms_ap.csv', async (route) => {
    requests += 1;
    if (requests === 1) {
      await gate;
      await route.fulfill({ status: 503, body: 'offline' });
    } else await route.continue();
  });
  try {
    await page.goto('/app/');
    await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Download feature data' });
    const button = dialog.locator('[data-artifact-id="rms_ap-csv"]');
    await button.click();
    const status = dialog.locator('.operation-status');
    await expect(status).toContainText('Downloading artifact…');
    await expect(button).toBeDisabled();
    // A cursor update rerenders the app while the operation owns this row.
    await page.evaluate(() => {
      const slider = document.querySelector<HTMLInputElement>('#coronal-slice-slider')!;
      slider.value = '83';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(status).toContainText('Downloading artifact…');
    release();
    await expect(status).toContainText('Couldn’t download this artifact');
    await expect(button).toBeEnabled();
    await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('aria-busy', 'false');
    const downloadPromise = page.waitForEvent('download');
    await status.getByRole('button', { name: 'Retry' }).click();
    expect((await downloadPromise).suggestedFilename()).toBe('rms_ap.csv');
    await expect(dialog).not.toBeVisible();
    expect(requests).toBe(2);
  } finally { release(); }
});

test('failed adjacent slice retries without clearing other ready views or charts', async ({ page }) => {
  let allowRecovery = false;
  await page.route('**/registered/coronal/11.isvg.gz', async (route) => {
    if (!allowRecovery) await route.fulfill({ status: 503, body: 'offline' });
    else await route.continue();
  });
  await page.goto('/app/');
  const frame = page.locator('[data-view="coronal"]');
  const renderer = frame.locator('.view-frame__renderer');
  await expect(renderer).toHaveAttribute('data-asset-index', '660');
  await page.getByLabel('coronal slice').fill('88');
  const status = frame.locator('.operation-status[data-variant="compact"]');
  await expect(status).toContainText('Couldn’t load this view');
  await expect(frame).toHaveAttribute('aria-busy', 'false');
  await expect(renderer).toHaveAttribute('data-asset-index', '660');
  await expect(renderer).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('.distribution-chart__global')).toBeAttached();
  await expect(page.locator('[data-view="sagittal"]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('[data-view="horizontal"]')).toHaveAttribute('aria-busy', 'false');
  allowRecovery = true;
  await status.getByRole('button', { name: 'Retry' }).click();
  await expect(renderer).toHaveAttribute('data-asset-index', '708');
  await expect(status).toBeHidden();
  await expect(renderer).toHaveCSS('pointer-events', 'auto');
});
