import { expect, test } from '@playwright/test';

test('intact crossing surfaces keep their original side colours and picks after movement', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
  const points = await page.evaluate(async () => {
    const { RetainedBrainScene3DViewportFactory } = await import('/src/rendering/3d/brain-scene-viewport.ts');
    const host = document.createElement('div');
    host.id = 'native-side-test';
    host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;z-index:99999';
    document.body.append(host);
    const presentations = [
      { presentation_id: 0, source_allen_id: 315, signed_allen_id: -315, side: 'left', mappings: { allen: -315, beryl: -315, cosmos: -315 } },
      { presentation_id: 1, source_allen_id: 315, signed_allen_id: 315, side: 'right', mappings: { allen: 315, beryl: 315, cosmos: 315 } },
    ];
    const components = [0, 1].map((id) => ({ component_id: id, source_allen_id: 315, lateralization: 'neutral', left_presentation_id: 0, right_presentation_id: 1, explode_displacement_um: id === 0 ? [4, 0, 0] : [0, 0, 0] }));
    const positions = new Float32Array([-2, 0, 1, 2, 0, 1, 0, 0, 4, -2, 0, -3, 2, 0, -3, 0, 0, 0]);
    const source = {
      async loadManifest() { return { schema_version: '1.0', format: 'atlas-mesh-pack-v1', pack_id: 'crossing-test', geometry_id: 'crossing-test', immutable: true,
        purpose: 'test-only', reference_space_id: 'allen-ccf-2017', geometry_policy: 'native-components',
        presentation_boundary: { coordinate: 'original-world-ml', threshold_um: 0, on_plane_side: 'right', status: 'provisional-test-only' },
        presentations, components, default_lod_id: 'default', upgrade_lod_id: null, lods: [] }; },
      async loadDefault() { return { id: 'default', byteLength: 200, chunks: [{ chunkId: 'all', positions,
        normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]),
        componentIds: new Uint16Array([0, 0, 0, 1, 1, 1]), indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        ranges: [0, 1].map((id) => ({ componentId: id, leftPresentationId: 0, rightPresentationId: 1, indexStart: id * 3, indexCount: 3, vertexStart: id * 3, vertexCount: 3 })) }] }; },
      async loadUpgrade() { return null; }, dispose() {},
    };
    const factory = new RetainedBrainScene3DViewportFactory(source);
    factory.setInteractionSink({ regionPointer(event) { host.dataset[event.type] = String(event.regionId); } });
    const viewport = factory.create(host);
    const base = { mapping: 'allen', anatomyColors: new Map([[-315, '#0000ff'], [315, '#00ff00']]),
      featureColors: null, featureSide: null, visibleRegionIds: new Set([-315, 315]), selectedRegionIds: new Set(), highlightedRegionId: null };
    viewport.setPresentation(base);
    viewport.activate();
    await new Promise<void>((resolve) => { const ready = () => host.dataset.scene3dState === 'ready' ? resolve() : requestAnimationFrame(ready); ready(); });
    const pose = { positionUm: [2, -16, .5], targetUm: [2, 0, .5], up: [0, 0, 1] };
    viewport.setViewState({ explode: 0, camera: pose });
    const scale = 300 / (16 * Math.tan(19 * Math.PI / 180));
    const screen = (x: number, z: number) => ({ x: 400 + (x - 2) * scale, y: 300 - (z - .5) * scale });
    // Test-owned hook only: no production global or alternate renderer.
    (window as any).nativeSideTest = {
      explode(value: number) { viewport.setViewState({ explode: value, camera: pose }); },
      visible(ids: number[]) { viewport.setPresentation({ ...base, visibleRegionIds: new Set(ids) }); },
      select(ids: number[]) { viewport.setPresentation({ ...base, selectedRegionIds: new Set(ids) }); },
    };
    return { left: screen(-.5, 2), right: screen(.5, 2), movedLeft: screen(3.5, 2), movedRight: screen(4.5, 2), fixed: screen(-.5, -2) };
  });
  const host = page.locator('#native-side-test');
  const canvas = host.locator('canvas');
  await expect(canvas).toHaveAttribute('width', '800');
  await expect(canvas).toHaveAttribute('height', '600');
  await expect.poll(async () => Number(await host.getAttribute('data-render-count'))).toBeGreaterThan(0);
  const checkPick = async (point: { x: number; y: number }, id: number) => {
    await page.mouse.move(point.x, point.y);
    await expect(host).toHaveAttribute('data-hover', String(id));
    await page.mouse.click(point.x, point.y);
    await expect(host).toHaveAttribute('data-select', String(id));
  };
  const sample = async (point: { x: number; y: number }) => {
    const screenshot = await canvas.screenshot();
    return page.evaluate(async ({ data, point }) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data];
    }, { data: screenshot.toString('base64'), point });
  };
  await checkPick(points.left, -315);
  await checkPick(points.right, 315);
  const leftColor = await sample(points.left);
  const rightColor = await sample(points.right);
  expect(leftColor[2]).toBeGreaterThan(150); expect(leftColor[1]).toBeLessThan(10);
  expect(rightColor[1]).toBeGreaterThan(150); expect(rightColor[2]).toBeLessThan(10);
  await page.evaluate(() => (window as any).nativeSideTest.explode(1));
  await checkPick(points.movedLeft, -315);
  await checkPick(points.movedRight, 315);
  await checkPick(points.fixed, -315);
  expect(await sample(points.movedLeft)).toEqual(leftColor);
  expect(await sample(points.movedRight)).toEqual(rightColor);
  await page.evaluate(() => (window as any).nativeSideTest.visible([315]));
  expect((await sample(points.movedLeft))[2]).toBeLessThan(100);
  expect((await sample(points.movedRight))[1]).toBeGreaterThan(150);
  expect((await sample(points.fixed))[2]).toBeLessThan(100);
  await page.evaluate(() => (window as any).nativeSideTest.select([-315]));
  expect((await sample(points.movedRight))[1]).toBeLessThan(150);
  await expect(host).toHaveAttribute('data-geometry-uploads', '1');
});
