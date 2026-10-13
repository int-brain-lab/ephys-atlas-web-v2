import { expect, test } from '@playwright/test';

test('context darkens beneath topmost outlines while selected interiors remain exact', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.atlas-app')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { SvgSliceRenderer } = await import('/src/rendering/svg-slice-renderer.ts');
    const host = document.createElement('div');
    host.dataset.selectionVisibilityHarness = 'true';
    host.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px;background:#071019;z-index:1000';
    host.innerHTML = '<svg class="view-frame__brain-svg" width="200" height="200"><g class="view-frame__slice-figure"></g><g></g></svg>';
    document.body.append(host);
    const svg = host.querySelector('svg')!;
    const renderer = new SvgSliceRenderer({ svg, figureLayer: svg.children[0] as SVGGElement, guideLayer: svg.children[1] as SVGGElement });
    renderer.render({ axis: 'coronal', index: 0, mapping: 'allen', viewBox: { x: 0, y: 0, width: 200, height: 200 }, guides: [],
      svgFragment: '<g transform="translate(10 10)"><path data-allen-id="-1" d="M70 70H90V90H70Z"/></g><path data-allen-id="-2" d="M20 20H180V180H20Z M80 80H100V100H80Z" fill-rule="evenodd"/>',
      regionColors: new Map([[-1, '#ff0000'], [-2, '#00ff00']]), selectedRegionIds: new Set([-1]),
    });
    const result = { overlayBeforeGuides: svg.children[1]?.classList.contains('projection-selection'),
      duplicateAssetIds: svg.querySelectorAll('.projection-selection [data-allen-id]').length,
      exportedOverlay: renderer.exportSvg().querySelector('.projection-selection'),
    };
    host.addEventListener('test-cleanup', () => { renderer.dispose(); host.remove(); }, { once: true });
    return result;
  });
  await expect(page.locator('[data-selection-visibility-harness] .projection-selection__inner path').first()).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  const screenshot = await page.locator('[data-selection-visibility-harness]').screenshot({ animations: 'disabled' });
  const pixels = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    const result = { center: pixel(90, 90), innerEdge: pixel(81, 90), exterior: pixel(79, 90), darkEdge: pixel(78, 90), neighboringFill: pixel(60, 90), background: pixel(10, 10) };
    bitmap.close();
    document.querySelector('[data-selection-visibility-harness]')!.dispatchEvent(new Event('test-cleanup'));
    return result;
  }, [...screenshot]);
  expect(pixels.center).toEqual([255, 0, 0, 255]);
  expect(pixels.innerEdge).toEqual([255, 0, 0, 255]);
  expect(pixels.exterior).toEqual([255, 255, 255, 255]);
  expect(pixels.darkEdge.slice(0, 3)).toEqual([7, 16, 25]);
  expect(pixels.neighboringFill).toEqual([0, 184, 0, 255]);
  expect(pixels.background).toEqual([7, 16, 25, 255]);
  expect(result.overlayBeforeGuides).toBe(true);
  expect(result.duplicateAssetIds).toBe(0);
  expect(result.exportedOverlay).toBeNull();
});

test('tiny locator can be replayed from the selected entry without navigation or exports', async ({ page }) => {
  await page.goto('/app/?v=4&autoslice=0&selected=-362');
  const locate = page.getByRole('button', { name: 'Locate MD in the current views', exact: true });
  await expect(locate).toBeVisible();
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');
  const cursor = new URL(page.url()).searchParams.get('cursor');
  await locate.click();
  const locator = page.locator('[data-view="coronal"] .projection-selection__locator');
  await expect(locator.locator('circle')).toHaveCount(1);
  await expect(locator.locator('text')).toHaveText('MD');
  expect(new URL(page.url()).searchParams.get('cursor')).toBe(cursor);
  await expect(locator).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: 'Clear region selection in coronal view' }).click();
  await expect(locator.locator('circle')).toHaveCount(0);
  await expect(page.locator('.projection-selection__inner path')).toHaveCount(0);
  await expect(page.locator('.projection-selection__context')).toHaveCount(0);
});

test('absent and partially represented selections have per-view feedback', async ({ page }) => {
  await page.goto('/app/?v=4&autoslice=0&selected=-595&secondary=top');
  const status = page.locator('[data-secondary-panel="top"] .projection-selection-status');
  await expect(status).toHaveText('Selected region not represented in this map');
  await expect(status).toBeVisible();
  await expect(page.locator('[data-secondary-panel="top"] .projection-selection__context')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear region selection in secondary view' }).click();
  await expect(status).toBeHidden();
});

test('a disconnected tiny region locates its largest fragment', async ({ page }) => {
  await page.goto('/app/');
  const center = await page.evaluate(async () => {
    const { SvgSliceRenderer } = await import('/src/rendering/svg-slice-renderer.ts');
    const host = document.createElement('div');
    host.innerHTML = '<svg width="200" height="200"><g></g><g></g></svg>';
    document.body.append(host);
    const svg = host.querySelector('svg')!;
    const renderer = new SvgSliceRenderer({ svg, figureLayer: svg.children[0] as SVGGElement, guideLayer: svg.children[1] as SVGGElement });
    renderer.render({ axis: 'coronal', index: 0, mapping: 'allen', viewBox: { x: 0, y: 0, width: 200, height: 200 }, guides: [],
      svgFragment: '<path data-allen-id="-1" d="M10 10h1v1h-1Z"/><path data-allen-id="-1" d="M80 80h10v10h-10Z"/>', selectedRegionIds: new Set([-1]),
    });
    const circle = svg.querySelector('circle')!;
    const center = [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))];
    renderer.dispose(); host.remove();
    return center;
  });
  expect(center).toEqual([85, 85]);
});
