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
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();
  // Keep the asynchronous module/setup promise reachable while CDP awaits it.
  await page.evaluate(() => (window as any).oitSetup = (async () => {
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
    (window as any).oitTest = {create, exportImage(options:any){return viewport.exportImage(options);}, highlight(id:number|null){viewport.setPresentation({...base,highlightedRegionId:id});}, select(ids:number[]){viewport.setPresentation({...base,selectedRegionIds:new Set(ids)});}, visible(ids:number[]){viewport.setPresentation({...base,visibleRegionIds:new Set(ids)});}, destroy(){factory.destroy();}};
    create(false,false);
  })());
  await page.evaluate(() => { delete (window as any).oitSetup; });
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
      const rgba=context.getImageData(0,0,image.width,image.height).data;
      const state=(window as any).oitTest;
      const baseline: Uint8ClampedArray | undefined = state.baselinePixels;
      let maxDifference: number | null = null;
      if (baseline) {
        if (baseline.length === rgba.length) {
          maxDifference = 0;
          for (let index=0; index<rgba.length; index++) maxDifference=Math.max(maxDifference,Math.abs(rgba[index]! - baseline[index]!));
        }
      } else {
        state.baselinePixels = new Uint8ClampedArray(rgba);
      }
      const sample = (x:number,y:number) => Array.from(rgba.slice((y*image.width+x)*4,(y*image.width+x)*4+3));
      let brightRgbComponents = 0;
      for (let index=0; index<rgba.length; index++) if (index % 4 !== 3 && rgba[index]! > 100) brightRgbComponents++;
      return {left:sample(175,220),right:sample(225,220),brightRgbComponents,maxDifference};
    }, bytes.toString('base64'));
  };
  const initial = await pixels();
  const left = initial.left; const right = initial.right;
  expect(left[2]).toBeGreaterThan(180); // opaque blue survives behind translucent red
  expect(left[0]).toBeGreaterThan(50); // front red contributes
  expect(left[1]).toBeLessThan(30); // green behind opaque blue is rejected
  expect(right[0]).toBeGreaterThan(50); expect(right[1]).toBeGreaterThan(50);
  const exported = await page.evaluate(async () => {
    const state = (window as any).oitTest;
    const decode = async (blob: Blob) => {
      const image = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,image.width,image.height).data;
      image.close(); return {width:canvas.width,height:canvas.height,pixels};
    };
    const baseline = await decode(await state.exportImage({longestEdge:800}));
    state.highlight(1);
    const hovered = await decode(await state.exportImage({longestEdge:800}));
    let difference=0;
    for(let i=0;i<baseline.pixels.length;i++) difference=Math.max(difference,Math.abs(baseline.pixels[i]! - hovered.pixels[i]!));
    state.highlight(null);
    const sample=(x:number,y:number)=>Array.from(baseline.pixels.slice((y*baseline.width+x)*4,(y*baseline.width+x)*4+4));
    const defaultImage = await createImageBitmap(await state.exportImage());
    const defaultSize=[defaultImage.width,defaultImage.height];defaultImage.close();
    const colorbar = document.createElementNS('http://www.w3.org/2000/svg','svg');
    colorbar.setAttribute('viewBox','0 0 600 100');
    colorbar.innerHTML='<rect width="600" height="100" fill="#ff0000" />';
    document.body.append(colorbar);
    const withColorbar=await decode(await state.exportImage({longestEdge:800,colorbar}));
    colorbar.remove();
    const barPixel=(Math.floor(withColorbar.height*.96)*withColorbar.width+Math.floor(withColorbar.width/2))*4;
    return {width:baseline.width,height:baseline.height,corner:sample(0,0),left:sample(350,440),right:sample(450,440),difference,defaultSize,barSize:[withColorbar.width,withColorbar.height],barPixel:Array.from(withColorbar.pixels.slice(barPixel,barPixel+4))};
  });
  expect(exported.width).toBe(800); expect(exported.height).toBe(800);
  expect(exported.defaultSize).toEqual([2400,2400]);
  expect(exported.corner[3]).toBe(0);
  expect(exported.left[3]).toBe(255); // opaque geometry keeps full coverage
  expect(exported.right[3]).toBeGreaterThan(0);
  expect(exported.right[3]).toBeLessThan(255); // OIT context retains transparent alpha
  expect(exported.difference).toBe(0); // transient hover never enters the export
  expect(exported.barSize[0]).toBeLessThan(800); expect(exported.barSize[1]).toBe(800);
  expect(exported.barPixel).toEqual([255,0,0,255]);
  await expect(host.locator('canvas')).toHaveAttribute('width','400');
  for (const split of [false,true]) {
    await page.evaluate((split) => (window as any).oitTest.create(true,split), split);
    const reversed = await pixels();
    expect(reversed.maxDifference).not.toBeNull();
    expect(reversed.maxDifference!).toBeLessThanOrEqual(2);
  }
  await page.mouse.move(225,220); await expect(host).toHaveAttribute('data-pick','1');
  await page.evaluate(() => (window as any).oitTest.select([]));
  await expect(host).toHaveAttribute('data-transparency','opaque');
  await page.evaluate(() => (window as any).oitTest.select([3]));
  await expect(host).toHaveAttribute('data-transparency','weighted-blended');
  await expect(host).toHaveAttribute('data-geometry-uploads','3');
  await page.evaluate(() => { document.querySelector<HTMLElement>('#oit-test')!.style.width='500px'; });
  await expect(host.locator('canvas')).toHaveAttribute('width','500');
  const rectangularExport = await page.evaluate(async () => {
    const image=await createImageBitmap(await (window as any).oitTest.exportImage({longestEdge:800}));
    const size=[image.width,image.height];image.close();return size;
  });
  expect(rectangularExport).toEqual([800,640]);
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
  expect(restored.brightRgbComponents).toBeGreaterThan(1000);
  // Directional shading must reveal orientation, not the nearly flat absolute
  // normal dot product used before. Both cases retain the same OIT coverage.
  await page.evaluate(() => { document.querySelector<HTMLElement>('#oit-test')!.style.width='400px'; });
  await expect(host.locator('canvas')).toHaveAttribute('width','400');
  await page.evaluate(() => (window as any).oitTest.create(false,false,[-.55,.65,.75]));
  const lit = await pixels();
  await page.evaluate(() => (window as any).oitTest.create(false,false,[.55,-.65,.1]));
  const shaded = await pixels();
  expect(lit.left[2]! - shaded.left[2]!).toBeGreaterThan(30);
  await page.evaluate(() => {
    const state = (window as any).oitTest;
    state.destroy();
    delete state.baselinePixels;
  });
  await expect(host).toHaveAttribute('data-scene3d-state','destroyed');
  expect(errors).toEqual([]);
});
