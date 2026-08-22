import { expect, test } from '@playwright/test';

test('retained 3-D lab loads the canonical pack with bounded requests and retained uploads', async ({ page }) => {
  const fixtureRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/__mesh-pack-fixture/')) fixtureRequests.push(new URL(request.url()).pathname);
  });
  await page.goto('/3d-lab/');
  const scene = page.locator('#scene');
  await expect(scene).toHaveAttribute('data-scene3d-state', 'ready');
  await expect(scene).toHaveAttribute('data-lod', 'default');
  await expect(scene).toHaveAttribute('data-geometry-uploads', '2');
  expect(fixtureRequests).toEqual([
    '/__mesh-pack-fixture/manifest.json',
    '/__mesh-pack-fixture/default.eam3.gz',
  ]);

  await page.locator('#explode').fill('0.75');
  await expect(scene).toHaveAttribute('data-explode', '0.75');
  await page.locator('#mapping').selectOption('cosmos');
  await expect(scene).toHaveAttribute('data-geometry-uploads', '2');
  await expect(scene).toHaveAttribute('data-presentation-updates', '2');
});

test('3-D viewport deactivates, reactivates, resets camera, and recovers context', async ({ page }) => {
  await page.goto('/3d-lab/');
  const scene = page.locator('#scene');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-scene3d-state', 'ready');
  await page.waitForTimeout(80);
  await page.locator('#deactivate').click();
  const before = Number(await scene.getAttribute('data-render-count'));
  await page.waitForTimeout(80);
  expect(Number(await scene.getAttribute('data-render-count'))).toBe(before);
  await page.locator('#deactivate').click();
  await expect.poll(async () => Number(await scene.getAttribute('data-render-count'))).toBeGreaterThan(before);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .45, box!.y + box!.height * .5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .65, box!.y + box!.height * .6, { steps: 4 });
  await page.mouse.up();
  await expect(scene).toHaveAttribute('data-camera-phase', 'end');
  await canvas.dblclick({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(scene).toHaveAttribute('data-camera-phase', 'change');

  await canvas.evaluate((element) => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2') ?? (element as HTMLCanvasElement).getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    (window as unknown as { contextLossExtension?: WEBGL_lose_context }).contextLossExtension = extension ?? undefined;
    extension?.loseContext();
  });
  await expect(scene).toHaveAttribute('data-scene3d-state', 'context-lost');
  await canvas.evaluate(() => {
    (window as unknown as { contextLossExtension?: WEBGL_lose_context }).contextLossExtension?.restoreContext();
  });
  await expect(scene).toHaveAttribute('data-scene3d-state', 'ready');
});

test('3-D picking returns signed IDs and a camera drag does not select', async ({ page }) => {
  await page.goto('/3d-lab/');
  const scene = page.locator('#scene');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-scene3d-state', 'ready');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width * .5, box!.y + box!.height * .5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .55, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#diagnostics')).toHaveText('');
  await canvas.dblclick({ position: { x: box!.width / 2, y: box!.height / 2 } });

  const signed = new Set<number>();
  for (const y of [.3, .4, .5, .6, .7]) for (const x of [.2, .3, .4, .5, .6, .7, .8]) {
    await canvas.click({ position: { x: box!.width * x, y: box!.height * y } });
    const id = Number(await scene.getAttribute('data-last-region-id'));
    if (Number.isInteger(id) && id !== 0) signed.add(id);
  }
  expect([...signed].some((id) => id < 0)).toBe(true);
  expect([...signed].some((id) => id > 0)).toBe(true);

  await page.locator('#mapping').selectOption('beryl');
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(page.locator('#diagnostics')).toHaveText('');
});

test('a failed upgrade retains the default LOD and destruction releases viewport ownership', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RetainedBrainScene3DViewportFactory } = await import('/src/rendering/3d/brain-scene-viewport.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;width:320px;height:240px';
    document.body.append(host);
    const triangle = (hemisphere: 'left' | 'right', featureId: number, signedAllenId: number) => ({
      hemisphere,
      positions: new Float32Array([signedAllenId < 0 ? -2 : 0, -1, 0, signedAllenId < 0 ? 0 : 2, -1, 0, signedAllenId < 0 ? -1 : 1, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      featureIds: new Uint16Array([featureId, featureId, featureId]),
      indices: new Uint32Array([0, 1, 2]),
      ranges: [{ featureId, signedAllenId, signedExplodeGroupId: signedAllenId, indexStart: 0, indexCount: 3, vertexStart: 0, vertexCount: 3 }],
    });
    let disposed = false;
    const source = {
      async loadManifest() { return {
        schema_version: '1.0', format: 'atlas-mesh-pack-v1', pack_id: 'test', geometry_id: 'test', immutable: true,
        purpose: 'test-only', reference_space_id: 'allen-ccf-2017', default_lod_id: 'default', upgrade_lod_id: 'upgrade', lods: [],
        regions: [
          { feature_id: 0, source_allen_id: 1, signed_allen_id: -1, hemisphere: 'left', mappings: { allen: -1, beryl: null, cosmos: -1 }, signed_explode_group_id: -1 },
          { feature_id: 1, source_allen_id: 1, signed_allen_id: 1, hemisphere: 'right', mappings: { allen: 1, beryl: null, cosmos: 1 }, signed_explode_group_id: 1 },
        ],
      }; },
      async loadDefault() { return { id: 'default', chunks: [triangle('left', 0, -1), triangle('right', 1, 1)], byteLength: 128 }; },
      async loadUpgrade() { throw new Error('synthetic upgrade failure'); },
      dispose() { disposed = true; },
    };
    const factory = new RetainedBrainScene3DViewportFactory(source);
    let cameraPose: unknown = null;
    factory.setInteractionSink({ cameraChanged(pose) { cameraPose = pose; } });
    const viewport = factory.create(host);
    viewport.setPresentation({ mapping: 'allen', anatomyColors: new Map(), featureColors: null, visibleRegionIds: new Set([-1, 1]), selectedRegionIds: new Set(), highlightedRegionId: null, featureSide: null });
    viewport.activate();
    await new Promise<void>((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        if (host.dataset.upgradeError === 'true') resolve();
        else if (performance.now() - started > 3000) reject(new Error('upgrade failure was not observed'));
        else requestAnimationFrame(poll);
      };
      poll();
    });
    const canvas = host.querySelector('canvas')!;
    const initialWidth = canvas.width;
    host.style.width = '480px';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    viewport.setViewState({ explode: 0, camera: { positionUm: [0, -10, 5], targetUm: [0, 0, 0], up: [0, 0, 1] } });
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0 }));
    const retained = { lod: host.dataset.lod, uploads: host.dataset.geometryUploads, canvas: host.querySelectorAll('canvas').length };
    factory.destroy();
    return { retained, resized: canvas.width > initialWidth, cameraPose, disposed, state: host.dataset.scene3dState, canvasesAfter: host.querySelectorAll('canvas').length };
  });
  expect(result).toEqual({
    retained: { lod: 'default', uploads: '2', canvas: 1 },
    resized: true,
    cameraPose: { positionUm: [0, -10, 5], targetUm: [0, 0, 0], up: [0, 0, 1] },
    disposed: true,
    state: 'destroyed',
    canvasesAfter: 0,
  });
});
