import { expect, test } from '@playwright/test';

test('stopping during startup prevents late catalog hydration and repeated starts share one load', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  let release!: () => void;
  let requests = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/catalog.json?lifecycle=stop', async (route) => {
    requests += 1;
    await gate;
    await route.continue();
  });
  try {
    const sharesStartup = await page.evaluate(async () => {
      const { AtlasApp } = await import('/src/app.ts');
      const root = document.createElement('div');
      document.body.append(root);
      const app = new AtlasApp(root, { catalogUrl: '/__real-data/catalog.json?lifecycle=stop' });
      const startup = app.start();
      const repeated = app.start();
      (window as any).startupTest = { app, root, startup };
      return startup === repeated;
    });
    expect(sharesStartup).toBe(true);
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(() => {
      const state = (window as any).startupTest;
      state.app.stop();
      state.app.stop();
      state.stoppedState = state.app.store.getState();
    });
    release();
    const outcome = await page.evaluate(async () => {
      const { app, root, startup, stoppedState } = (window as any).startupTest;
      await startup;
      await app.start();
      const result = {
        unchangedState: app.store.getState() === stoppedState,
        catalog: app.session.snapshot().catalog,
        manifest: app.session.snapshot().manifest,
        subscribed: app.stopApplicationStore !== null,
      };
      root.remove();
      return result;
    });
    expect(outcome).toEqual({ unchangedState: true, catalog: null, manifest: null, subscribed: false });
    expect(requests).toBe(1);
  } finally { release(); }
});

test('catalog refresh callers apply only the newest result and ignore results after teardown', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  const outcome = await page.evaluate(async () => {
    const { AtlasApp } = await import('/src/app.ts');
    const root = document.createElement('div');
    document.body.append(root);
    const app: any = new AtlasApp(root, { catalogUrl: '/__real-data/catalog.json' });
    await app.start();
    const catalog = app.session.snapshot().catalog;
    const pending: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
    const applied: string[] = [];
    app.session.loadCatalog = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    app.urlController.setCatalog = (value: any) => applied.push(value.testVersion);
    try {
      const older = app.retryCatalog();
      const newer = app.retryCatalog();
      pending[1]!.resolve({ ...catalog, testVersion: 'newer' });
      await newer;
      pending[0]!.resolve({ ...catalog, testVersion: 'older' });
      await older;

      const failingOlder = app.retryCatalog();
      const newest = app.retryCatalog();
      pending[3]!.resolve({ ...catalog, testVersion: 'newest' });
      await newest;
      pending[2]!.reject(new Error('obsolete refresh failure'));
      await failingOlder;

      const stopped = app.retryCatalog();
      app.stop();
      pending[4]!.resolve({ ...catalog, testVersion: 'after-stop' });
      await stopped;
      return applied;
    } finally { app.stop(); root.remove(); }
  });
  expect(outcome).toEqual(['newer', 'newest']);
});
