import { expect, test } from '@playwright/test';

test('3-D context is registry-driven, URL-persisted, responsive, and mesh-request free', async ({ page }) => {
  const meshRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('mesh') || request.url().includes('eam3')) meshRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/?v=4&secondary=brain-3d&compact=secondary&max=secondary&explode3d=0.4&camera3d=0,-5,3,0,0,0,0,0,1');

  const tab = page.getByRole('tab', { name: '3-D' });
  const panel = page.locator('[data-secondary-panel="brain-3d"]');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-scene3d-host="null"]')).toHaveCount(1);
  await expect(panel).toContainText('not connected');
  await expect(panel.locator('canvas')).toHaveCount(0);
  expect(meshRequests).toEqual([]);
  expect(new URL(page.url()).searchParams.get('explode3d')).toBe('0.4');
  expect(new URL(page.url()).searchParams.get('camera3d')).toBe('0,-5,3,0,0,0,0,0,1');

  await page.reload();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();
  expect(meshRequests).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.locator('.secondary-view')).toHaveAttribute('data-maximized', 'false');
  await tab.focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();
  expect(meshRequests).toEqual([]);
});
