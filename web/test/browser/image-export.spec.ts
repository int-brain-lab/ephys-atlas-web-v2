import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function downloadBytes(page: Page, format: 'SVG' | 'PNG'): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download image', exact: true })
    .getByRole('button', { name: `Download ${format}`, exact: true }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  await page.getByRole('dialog', { name: 'Download image', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  return { download, bytes };
}

async function inspectSvg(page: Page, bytes: Buffer) {
  return page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = document.documentElement;
    return {
      errors: document.querySelectorAll('parsererror').length,
      namespace: root.namespaceURI,
      viewBox: root.getAttribute('viewBox'),
      width: Number(root.getAttribute('width')),
      height: Number(root.getAttribute('height')),
      paths: [...root.querySelectorAll('path')].map((path) => ({
        d: path.getAttribute('d'),
        style: path.getAttribute('style'),
        fill: path.getAttribute('fill'),
        stroke: path.getAttribute('stroke'),
        fillOpacity: path.getAttribute('fill-opacity'),
        strokeOpacity: path.getAttribute('stroke-opacity'),
      })),
      guides: root.querySelectorAll('.slice-guide, .slice-guides, [data-source-axis]').length,
      highlights: root.querySelectorAll('.is-highlighted').length,
      foreignObjects: root.querySelectorAll('foreignObject').length,
      images: [...root.querySelectorAll('image')].map((image) => ({
        href: image.getAttribute('href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
        x: image.getAttribute('x'), y: image.getAttribute('y'),
        width: image.getAttribute('width'), height: image.getAttribute('height'),
        transform: image.getAttribute('transform'),
      })),
      colorbars: root.querySelectorAll('[data-export-colorbar="true"]').length,
    };
  }, bytes.toString('utf8'));
}

async function inspectPng(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    let visible = 0;
    let translucent = 0;
    const colors = new Set<string>();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3]!;
      if (alpha === 0) transparent += 1;
      else {
        visible += 1;
        if (alpha < 255) translucent += 1;
        if (colors.size < 64) colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
      }
    }
    return { width: canvas.width, height: canvas.height, transparent, visible, translucent, colors: colors.size };
  }, bytes.toString('base64'));
}

test('all orthogonal views download standalone vector anatomy without the crosshair', async ({ page }) => {
  await page.goto('/app/?v=4&autoslice=0');
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    const frame = page.locator(`[data-view="${axis}"]`);
    await expect(frame).toHaveAttribute('data-state', 'ready');
    const expectedPaths = await frame.locator('svg.projection-viewport__regional path').count();
    expect(expectedPaths).toBeGreaterThan(0);
    await page.getByRole('button', { name: `Download ${axis} image`, exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Include colorbar' })).not.toBeChecked();
    const { download, bytes } = await downloadBytes(page, 'SVG');
    expect(download.suggestedFilename()).toMatch(new RegExp(`${axis}.*\\.svg$`));
    const svg = await inspectSvg(page, bytes);
    expect(svg.errors).toBe(0);
    expect(svg.namespace).toBe('http://www.w3.org/2000/svg');
    expect(svg.paths).toHaveLength(expectedPaths);
    expect(svg.paths.every((path) => path.d && (path.style || path.fill || path.stroke))).toBe(true);
    expect(svg.guides).toBe(0);
    expect(svg.highlights).toBe(0);
    expect(svg.images).toHaveLength(0);
    expect(svg.colorbars).toBe(0);
    expect(Math.max(svg.width, svg.height)).toBe(2400);
  }
});

test('Top and Swanson export vectors with their native framing and optional colorbar', async ({ page }) => {
  await page.goto('/app/?v=4&secondary=top');
  for (const [name, pathCount] of [['Top', 114], ['Swanson', 808]] as const) {
    await page.getByRole('combobox', { name: 'Context view' }).selectOption({ label: name });
    await expect(page.locator(`[data-secondary-panel="${name.toLowerCase()}"] path`)).toHaveCount(pathCount);
    await page.getByRole('button', { name: 'Download secondary image', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Include colorbar' })).not.toBeChecked();
    const { bytes } = await downloadBytes(page, 'SVG');
    const svg = await inspectSvg(page, bytes);
    expect(svg.viewBox).toBe('60 20 340 300');
    expect(svg.paths).toHaveLength(pathCount);
    expect(svg.images).toHaveLength(0);
    expect(svg.foreignObjects).toBe(0);
    expect(svg.colorbars).toBe(0);
  }
  await page.getByRole('button', { name: 'Download secondary image', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include colorbar' }).check();
  const { bytes } = await downloadBytes(page, 'SVG');
  expect((await inspectSvg(page, bytes)).colorbars).toBe(1);
  await page.getByRole('combobox', { name: 'Context view' }).selectOption({ label: 'Summary' });
  await expect(page.getByRole('button', { name: 'Download secondary image', exact: true })).toBeHidden();
});

test('volume SVG embeds native raster pixels at the registered location under vector boundaries', async ({ page }) => {
  await page.goto('/app/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25&scale=linear&dist=full');
  const frame = page.locator('[data-view="coronal"]');
  await expect(frame.locator('[data-slice-asset="schema-volume-v1"]')).toBeAttached();
  const source = await frame.evaluate((root) => {
    const host = root.querySelector('.projection-viewport__scalar-host')!;
    const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
    const regional = root.querySelector<SVGSVGElement>('svg.projection-viewport__regional')!;
    return {
      x: host.getAttribute('x'), y: host.getAttribute('y'),
      width: host.getAttribute('width'), height: host.getAttribute('height'),
      viewBox: regional.getAttribute('viewBox'), paths: regional.querySelectorAll('path').length,
      png: canvas.toDataURL('image/png'),
      flipX: canvas.dataset.flipX === 'true', flipY: canvas.dataset.flipY === 'true',
    };
  });
  await page.getByRole('button', { name: 'Download coronal image', exact: true }).click();
  const { bytes } = await downloadBytes(page, 'SVG');
  const svg = await inspectSvg(page, bytes);
  expect(svg.paths).toHaveLength(source.paths);
  expect(svg.viewBox).toBe(source.viewBox);
  expect(svg.images).toHaveLength(1);
  expect(svg.images[0]).toMatchObject({ href: source.png, x: source.x, y: source.y, width: source.width, height: source.height });
  if (source.flipX || source.flipY) {
    const dx = source.flipX ? 2 * Number(source.x) + Number(source.width) : 0;
    const dy = source.flipY ? 2 * Number(source.y) + Number(source.height) : 0;
    expect(svg.images[0]!.transform).toBe(`translate(${dx} ${dy}) scale(${source.flipX ? -1 : 1} ${source.flipY ? -1 : 1})`);
  }
  expect(svg.foreignObjects).toBe(0);
  expect(svg.guides).toBe(0);
});


test('volume exports honor anatomy outline and color layer settings', async ({ page }) => {
  await page.goto('/app/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25');
  await expect(page.locator('[data-view="coronal"] [data-slice-asset="schema-volume-v1"]')).toBeAttached();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show anatomy outlines', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('button', { name: 'Download coronal image', exact: true }).click();
  const withoutOutlines = await inspectSvg(page, (await downloadBytes(page, 'SVG')).bytes);
  expect(withoutOutlines.images).toHaveLength(1);
  expect(withoutOutlines.paths.length).toBeGreaterThan(0);
  expect(withoutOutlines.paths.every((path) => Number(path.strokeOpacity) === 0)).toBe(true);
  expect(withoutOutlines.paths.every((path) => Number(path.fillOpacity) === 0)).toBe(true);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show anatomy outlines', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Show anatomy colours', exact: true }).check();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('button', { name: 'Download coronal image', exact: true }).click();
  const anatomy = await inspectSvg(page, (await downloadBytes(page, 'SVG')).bytes);
  expect(anatomy.images).toHaveLength(1);
  expect(anatomy.paths.every((path) => Number(path.fillOpacity) === 1)).toBe(true);
  expect(anatomy.paths.some((path) => Number(path.strokeOpacity) > 0)).toBe(true);
});

test('transparent PNG size and vector content are independent of panel maximization', async ({ page }) => {
  await page.goto('/app/?v=4&secondary=top');
  await expect(page.locator('[data-secondary-panel="top"] path')).toHaveCount(114);
  await page.getByRole('button', { name: 'Download secondary image', exact: true }).click();
  const first = await downloadBytes(page, 'PNG');
  expect(first.download.suggestedFilename()).toMatch(/\.png$/);
  const image = await inspectPng(page, first.bytes);
  expect(Math.max(image.width, image.height)).toBe(2400);
  expect(image.transparent).toBeGreaterThan(0);
  expect(image.visible).toBeGreaterThan(0);
  expect(image.colors).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Maximize secondary panel' }).click();
  await page.getByRole('button', { name: 'Download secondary image', exact: true }).click();
  const second = await downloadBytes(page, 'PNG');
  expect(await inspectPng(page, second.bytes)).toEqual(image);
});

test('3-D downloads a transparent PNG while retaining camera and live renderer dimensions', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/app/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25&parcel=allen&explode3d=0.4');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  // The canonical mesh fixture has parent315 geometry outside this Allen
  // leaf inventory. Colored 3D pixels and translucent compositing are covered
  // with a compatible synthetic presentation in weighted-transparency.spec.ts.
  await page.getByRole('combobox', { name: 'Context view' }).selectOption({ label: '3-D' });
  const host = page.locator('[data-scene3d-host="connected"]');
  await expect(host).toHaveAttribute('data-scene3d-state', 'ready', { timeout: 15_000 });
  await expect.poll(async () => Number(await host.getAttribute('data-render-count'))).toBeGreaterThan(0);
  const before = await host.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }));
  const urlBefore = page.url();
  const uploads = await host.getAttribute('data-geometry-uploads');
  await page.getByRole('button', { name: 'Download secondary image', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Download image', exact: true }).getByRole('button', { name: 'Download SVG', exact: true })).toBeHidden();
  const { bytes } = await downloadBytes(page, 'PNG');
  const image = await inspectPng(page, bytes);
  expect(Math.max(image.width, image.height)).toBe(2400);
  expect(image.transparent).toBeGreaterThan(0);
  expect(page.url()).toBe(urlBefore);
  expect(await host.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }))).toEqual(before);
  await expect(host).toHaveAttribute('data-geometry-uploads', uploads!);
  await expect(host).toHaveAttribute('data-scene3d-state', 'ready', { timeout: 15_000 });
});
