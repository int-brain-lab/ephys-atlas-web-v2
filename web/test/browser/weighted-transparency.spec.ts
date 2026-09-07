import { expect, test } from '@playwright/test';

for (const supported of [true, false]) test(supported
  ? 'weighted transparency is independent of triangle/chunk order and respects opaque depth'
  : 'unsupported transparency reports a recoverable error without sorted-blending fallback', async ({ page }) => {
  test.setTimeout(30_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  if (!supported) await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function(name: string) {
      return name === 'EXT_color_buffer_float' ? null : original.call(this, name);
    };
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const { RetainedBrainScene3DViewportFactory } = await import('/src/rendering/3d/brain-scene-viewport.ts');
    const host = document.createElement('div'); host.id = 'oit-test';
    host.style.cssText = 'position:fixed;inset:0;width:400px;height:400px;z-index:99999'; document.body.append(host);
    // Red in front, green behind, opaque blue between them over the left half.
    const positions = [[-3,-3,1, 3,-3,1, 0,3,1], [-3,-3,-1, 3,-3,-1, 0,3,-1], [-3,-3,0, 0,-3,0, 0,3,0]];
    const presentations = [1,2,3].map((id) => ({ presentation_id:id-1, source_allen_id:id, signed_allen_id:id, side:'right', mappings:{allen:id,beryl:id,cosmos:id} }));
    const components = presentations.map((p) => ({component_id:p.presentation_id, source_allen_id:p.source_allen_id, lateralization:'right', left_presentation_id:null, right_presentation_id:p.presentation_id, explode_displacement_um:[0,0,0]}));
    const base = {mapping:'allen', anatomyColors:new Map([[1,'#ff0000'],[2,'#00ff00'],[3,'#0000ff']]), featureColors:null, featureSide:null, visibleRegionIds:new Set([1,2,3]), selectedRegionIds:new Set([3]), highlightedRegionId:null};
    let factory: any; let viewport: any;
    const create = (reverse: boolean, split: boolean, normal = [0,0,1]) => {
      factory?.destroy();
      const order = reverse ? [2,1,0] : [0,1,2];
      const chunks = (split ? order.map((id) => [id]) : [order]).map((ids, index) => ({chunkId:String(index),
        positions:new Float32Array(ids.flatMap((id) => positions[id]!)),
        normals:new Float32Array(ids.flatMap(() => [...normal,...normal,...normal])),
        componentIds:new Uint16Array(ids.flatMap((id) => [id,id,id])),
        indices:new Uint32Array(ids.flatMap((_, i) => [i*3,i*3+1,i*3+2])),
        ranges:ids.map((id,i) => ({componentId:id, vertexStart:i*3,vertexCount:3,indexStart:i*3,indexCount:3})),
      }));
      const source = {
        async loadManifest(){return {presentations,components,presentation_boundary:{coordinate:'original-world-ml',threshold_um:0,on_plane_side:'right',status:'provisional-test-only'}};},
        async loadDefault(){return {id:'test',byteLength:300,chunks};},async loadUpgrade(){return null;},dispose(){},
      };
      factory = new RetainedBrainScene3DViewportFactory(source);
      factory.setInteractionSink({regionPointer(event:any){host.dataset.pick=String(event.regionId);}});
      viewport = factory.create(host); viewport.setPresentation(base);
      viewport.setViewState({explode:0,camera:{positionUm:[0,0,12],targetUm:[0,0,0],up:[0,1,0]}}); viewport.activate();
    };
    (window as any).oitTest = {create, select(ids:number[]){viewport.setPresentation({...base,selectedRegionIds:new Set(ids)});}, visible(ids:number[]){viewport.setPresentation({...base,visibleRegionIds:new Set(ids)});}, destroy(){factory.destroy();}};
    create(false,false);
  });
  const host = page.locator('#oit-test');
  if (!supported) {
    await expect(host).toHaveAttribute('data-scene3d-state','error');
    await expect(host).toHaveAttribute('data-error',/EXT_color_buffer_float/);
    await page.evaluate(() => (window as any).oitTest.select([]));
    await expect(host).toHaveAttribute('data-transparency','opaque');
    await expect(host).toHaveAttribute('data-scene3d-state','ready');
    await page.evaluate(() => (window as any).oitTest.destroy());
    expect(errors).toEqual([]);
    return;
  }
  const pixels = async () => {
    await expect(host).toHaveAttribute('data-transparency', 'weighted-blended');
    const bytes = await host.locator('canvas').screenshot();
    return page.evaluate(async (data) => {
      const image=new Image(); image.src=`data:image/png;base64,${data}`; await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
      return [...context.getImageData(0,0,image.width,image.height).data];
    }, bytes.toString('base64'));
  };
  const initial = await pixels();
  const sample = (x:number,y:number) => initial.slice((y*400+x)*4,(y*400+x)*4+3);
  const left = sample(175,220); const right = sample(225,220);
  expect(left[2]).toBeGreaterThan(180); // opaque blue survives behind translucent red
  expect(left[0]).toBeGreaterThan(50); // front red contributes
  expect(left[1]).toBeLessThan(30); // green behind opaque blue is rejected
  expect(right[0]).toBeGreaterThan(50); expect(right[1]).toBeGreaterThan(50);
  for (const split of [false,true]) {
    await page.evaluate((split) => (window as any).oitTest.create(true,split), split);
    const reversed = await pixels();
    expect(reversed.reduce((max,value,index) => Math.max(max,Math.abs(value-initial[index]!)),0)).toBeLessThanOrEqual(2);
  }
  await page.mouse.move(225,220); await expect(host).toHaveAttribute('data-pick','1');
  await page.evaluate(() => (window as any).oitTest.select([]));
  await expect(host).toHaveAttribute('data-transparency','opaque');
  await page.evaluate(() => (window as any).oitTest.select([3]));
  await expect(host).toHaveAttribute('data-transparency','weighted-blended');
  await expect(host).toHaveAttribute('data-geometry-uploads','3');
  await page.evaluate(() => { document.querySelector<HTMLElement>('#oit-test')!.style.width='500px'; });
  await expect(host.locator('canvas')).toHaveAttribute('width','500');
  await pixels();
  await page.evaluate(() => {
    const gl=document.querySelector<HTMLCanvasElement>('#oit-test canvas')!.getContext('webgl2')!;
    const extension=gl.getExtension('WEBGL_lose_context')!;
    (window as any).oitTest.restore = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect(host).toHaveAttribute('data-scene3d-state','context-lost');
  await page.evaluate(() => (window as any).oitTest.restore());
  await expect(host).toHaveAttribute('data-scene3d-state','ready');
  const restored = await pixels();
  expect(restored.filter((value,index) => index % 4 !== 3 && value > 100).length).toBeGreaterThan(1000);
  // Directional shading must reveal orientation, not the nearly flat absolute
  // normal dot product used before. Both cases retain the same OIT coverage.
  await page.evaluate(() => { document.querySelector<HTMLElement>('#oit-test')!.style.width='400px'; });
  await expect(host.locator('canvas')).toHaveAttribute('width','400');
  await page.evaluate(() => (window as any).oitTest.create(false,false,[-.55,.65,.75]));
  const lit = await pixels();
  await page.evaluate(() => (window as any).oitTest.create(false,false,[.55,-.65,.1]));
  const shaded = await pixels();
  expect(lit[(220*400+175)*4+2]! - shaded[(220*400+175)*4+2]!).toBeGreaterThan(30);
  await page.evaluate(() => (window as any).oitTest.destroy());
  await expect(host).toHaveAttribute('data-scene3d-state','destroyed');
  expect(errors).toEqual([]);
});
