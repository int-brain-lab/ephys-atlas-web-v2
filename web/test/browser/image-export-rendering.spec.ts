import { expect, test } from '@playwright/test';

test('standalone exports preserve colors, exclude selection outlines, hover and guides, and rasterize transparently', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { SvgSliceRenderer } = await import('/src/rendering/svg-slice-renderer.ts');
    const { exportSvgImage } = await import('/src/rendering/image-export.ts');
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = '<svg class="view-frame__brain-svg"><g class="view-frame__slice-figure"></g><g></g></svg>';
    const svg = host.querySelector('svg')!;
    const renderer = new SvgSliceRenderer({ svg, figureLayer: svg.children[0] as SVGGElement, guideLayer: svg.children[1] as SVGGElement });
    renderer.render({
      axis: 'coronal', index: 0, mapping: 'allen',
      svgFragment: '<path data-allen-id="-1" d="M10 10H40V40H10Z"/><path data-allen-id="-2" d="M50 10H80V40H50Z"/>',
      viewBox: { x: 0, y: 0, width: 100, height: 50 },
      guides: [{ sourceAxis: 'sagittal', targetAxis: 'coronal', dimension: 'x', position: 45 }],
      regionColors: new Map([[ -1, '#ff0000' ], [ -2, '#0000ff' ]]),
      selectedRegionIds: new Set([-1]), highlightedRegionIds: new Set([-2]),
    });
    const selected = svg.querySelector('[data-allen-id="-1"]')!;
    const hadSelectionOutline = svg.querySelector('.projection-selection__inner path') !== null;
    const hadSelectionLabel = svg.querySelector('.projection-selection__label') !== null;
    selected.classList.remove('is-selected');
    const normalStroke = getComputedStyle(selected).strokeWidth;
    selected.classList.add('is-selected');
    const highlighted = svg.querySelector('[data-allen-id="-2"]')!;
    highlighted.classList.remove('is-highlighted');
    const unselectedOpacity = getComputedStyle(highlighted).fillOpacity;
    highlighted.classList.add('is-highlighted');
    const blob = await exportSvgImage(renderer.exportSvg(), { format: 'svg' });
    const parsed = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    const paths = parsed.querySelectorAll('path');
    const png = await exportSvgImage(renderer.exportSvg(), { format: 'png', longestEdge: 200 });
    const bitmap = await createImageBitmap(png);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const cornerAlpha = context.getImageData(0, 0, 1, 1).data[3];
    const fillAlpha = context.getImageData(40, 40, 1, 1).data[3];
    const originalHighlighted = svg.querySelector('[data-allen-id="-2"]')!.classList.contains('is-highlighted');
    renderer.dispose(); host.remove();
    return {
      width: parsed.documentElement.getAttribute('width'), height: parsed.documentElement.getAttribute('height'),
      pathCount: paths.length, lineCount: parsed.querySelectorAll('line').length,
      selectedStroke: paths[0]!.getAttribute('stroke-width'), unselectedOpacity: paths[1]!.getAttribute('fill-opacity'),
      transientClass: parsed.querySelector('.is-highlighted') !== null,
      firstFill: paths[0]!.getAttribute('fill'), originalHighlighted,
      pngType: png.type, bitmapWidth: bitmap.width, bitmapHeight: bitmap.height, cornerAlpha, fillAlpha,
      selectionOutlineRemoved: hadSelectionOutline && paths[0]!.getAttribute('stroke-width') === normalStroke && !parsed.querySelector('.projection-selection'),
      selectionLabelsRemoved: hadSelectionLabel && !parsed.querySelector('.projection-selection__labels'),
      selectionHaloRemoved: paths[0]!.getAttribute('filter') === 'none',
      liveSelectionPreserved: selected.classList.contains('is-selected'),
      unhighlightedStylePreserved: paths[1]!.getAttribute('fill-opacity') === unselectedOpacity,
    };
  });
  expect(result.selectionOutlineRemoved).toBe(true);
  expect(result.selectionHaloRemoved).toBe(true);
  expect(result.selectionLabelsRemoved).toBe(true);
  expect(result.liveSelectionPreserved).toBe(true);
  expect(result.unhighlightedStylePreserved).toBe(true);
  expect(result).toMatchObject({
    width: '2400', height: '1200', pathCount: 2, lineCount: 0,
    transientClass: false,
    firstFill: 'rgb(255, 0, 0)', originalHighlighted: true,
    pngType: 'image/png', bitmapWidth: 200, bitmapHeight: 100, cornerAlpha: 0, fillAlpha: 255,
  });
});

test('retained exports reject loading, failed and cleared frames', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { RetainedProjectionViewportFactory } = await import('/src/rendering/retained-projection-viewport.ts');
    const target = document.createElement('div'); document.body.append(target);
    let fail = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const source = {
      async getDisplaySliceInventories() { throw new Error('unused'); },
      async loadSlice(axis: 'coronal' | 'sagittal' | 'horizontal', sliceIndex: number) {
        if (sliceIndex === 1) await gate;
        if (fail) throw new Error('fixture failure');
        return { axis, sliceIndex, worldCoordinateUm: 0, viewBox: { x: 0, y: 0, width: 100, height: 50 }, svgFragment: '<path data-allen-id="-1" d="M10 10H40V40H10Z"/>' };
      },
      async guidesForWorld() { return []; }, async prefetchNeighbor() {}, dispose() {},
    };
    const factory = new RetainedProjectionViewportFactory({ source });
    const viewport = factory.create(target, 'coronal');
    const model = (sliceIndex: number) => ({ axis: 'coronal' as const, sliceIndex, cursor: { xUm: 0, yUm: 0, zUm: 0 }, parcellation: 'allen' as const, feature: null });
    const rejected = async () => { try { await viewport.exportImage!({ format: 'svg' }); return false; } catch { return true; } };
    await viewport.render(model(0));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const initialExport = (await viewport.exportImage!({ format: 'svg' })).type;
    const pending = viewport.render(model(1));
    const loadingRejected = await rejected();
    release(); await pending;
    fail = true; await viewport.render(model(2))?.catch(() => undefined);
    const failureRejected = await rejected();
    viewport.clear(); const clearedRejected = await rejected();
    factory.destroy(); target.remove();
    return { initialExport, loadingRejected, failureRejected, clearedRejected };
  });
  expect(result).toEqual({ initialExport: 'image/svg+xml', loadingRejected: true, failureRejected: true, clearedRejected: true });
});
