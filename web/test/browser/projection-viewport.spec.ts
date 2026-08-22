import { expect, test } from '@playwright/test';

test('retained viewport shares region identity, guides, presentation, and interaction', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { RetainedProjectionViewportFactory } = await import('/src/rendering/retained-projection-viewport.ts');
    const target = document.createElement('div');
    target.id = 'retained-viewport-test';
    document.body.append(target);
    const source = {
      async getDisplaySliceInventories() { throw new Error('not used'); },
      async loadSlice(axis: 'coronal' | 'sagittal' | 'horizontal', sliceIndex: number) {
        return {
          axis,
          sliceIndex,
          worldCoordinateUm: 50,
          viewBox: { x: -0.5, y: -0.5, width: 3, height: 2 },
          svgFragment:
            '<path class="atlas-region" data-allen-id="-10" data-beryl-id="-20" data-cosmos-id="-30" d="M0 0L1 0L1 1Z"/>' +
            '<path class="atlas-region" data-allen-id="10" data-beryl-id="20" data-cosmos-id="30" d="M1 0L2 0L2 1Z"/>',
        };
      },
      async guidesForWorld(axis: 'coronal' | 'sagittal' | 'horizontal') {
        return [
          { sourceAxis: 'sagittal' as const, targetAxis: axis, dimension: 'x' as const, position: 1 },
          { sourceAxis: 'horizontal' as const, targetAxis: axis, dimension: 'y' as const, position: 2 },
        ];
      },
      async prefetchNeighbor() {},
      dispose() {},
    };
    const factory = new RetainedProjectionViewportFactory({ source });
    const presentation = {
      feature: {
        schemaVersion: '1.0' as const,
        featureId: 'fixture',
        representation: 'regional' as const,
        parcellation: 'beryl' as const,
        regionIds: ['-20'],
        statistics: { mean: [1] },
      },
      regions: [{ id: '-20', atlasId: -20, index: 0, acronym: 'R', name: 'Region', colorHex: '#123456' }],
      selectedRegionIds: ['-20'],
      hoveredRegionId: null as string | null,
      coloring: {
        mode: 'feature' as const,
        statistic: 'mean' as const,
        colormap: 'viridis',
        range: { mode: 'auto' as const },
        scale: 'linear' as const,
      },
    };
    factory.updatePresentation(presentation);
    factory.setInteractionSink({
      hover: (hit) => factory.updatePresentation({ ...presentation, hoveredRegionId: hit?.regionId ?? null }),
      inspect: () => undefined,
      toggleSelection: (hit) => { target.dataset.hit = hit.regionId; },
      stepSlice: () => undefined,
      moveCursor: () => undefined,
      reportError: () => undefined,
    });
    const viewport = factory.create(target, 'coronal');
    await viewport.render({
      axis: 'coronal',
      sliceIndex: 2,
      cursor: { xUm: 25, yUm: 50, zUm: 75 },
      parcellation: 'beryl',
      feature: null,
    });
    target.querySelector('path[data-beryl-id="20"]')?.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true }),
    );
    target.querySelector('path[data-beryl-id="20"]')?.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true }),
    );
  });

  const target = page.locator('#retained-viewport-test');
  await expect(target).toHaveAttribute('data-slice-asset', 'projection-pack-v1');
  await expect(target).toHaveAttribute('data-world-coordinate-um', '50');
  await expect(target).toHaveAttribute('data-hit', '-20');
  const leftPath = target.locator('path[data-beryl-id="-20"]');
  const rightPath = target.locator('path[data-beryl-id="20"]');
  await expect(leftPath).toHaveAttribute('style', /fill: rgb\(68, 1, 84\)/);
  await expect(rightPath).toHaveAttribute('style', /fill: rgb\(18, 52, 86\)/);
  for (const path of [leftPath, rightPath]) {
    await expect(path).toHaveClass(/is-selected/);
    await expect(path).toHaveClass(/is-highlighted/);
  }
  await expect(target.locator('.slice-guide[data-source-axis="sagittal"]')).toHaveAttribute('x1', '1');
  await expect(target.locator('.slice-guide[data-source-axis="horizontal"]')).toHaveAttribute('y1', '2');
});

test('retained viewport keeps its DOM and prepared SVG layers across navigation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RetainedProjectionViewportFactory } = await import('/src/rendering/retained-projection-viewport.ts');
    const target = document.createElement('div');
    document.body.append(target);
    const source = {
      async getDisplaySliceInventories() { throw new Error('not used'); },
      async loadSlice(axis: 'coronal' | 'sagittal' | 'horizontal', sliceIndex: number) {
        return {
          axis,
          sliceIndex,
          worldCoordinateUm: sliceIndex * 10,
          viewBox: { x: 0, y: 0, width: 2, height: 2 },
          svgFragment: `<path data-allen-id="-10" data-beryl-id="-20" data-cosmos-id="-30" d="M${sliceIndex} 0L1 0L1 1Z"/>`,
        };
      },
      async guidesForWorld() { return []; },
      async prefetchNeighbor() {},
      dispose() {},
    };
    const factory = new RetainedProjectionViewportFactory({ source });
    const viewport = factory.create(target, 'coronal');
    const root = target.firstElementChild;
    const svg = target.querySelector('svg');
    const model = (sliceIndex: number) => ({
      axis: 'coronal' as const,
      sliceIndex,
      cursor: { xUm: 0, yUm: 0, zUm: 0 },
      parcellation: 'allen' as const,
      feature: null,
    });
    await viewport.render(model(4));
    const firstPath = target.querySelector('path');
    await viewport.render(model(5));
    await viewport.render(model(4));
    return {
      stableRoot: root === target.firstElementChild,
      stableSvg: svg === target.querySelector('svg'),
      reusedPath: firstPath === target.querySelector('path'),
    };
  });
  expect(result).toEqual({ stableRoot: true, stableSvg: true, reusedPath: true });
});

test('retained viewport runs one geometry request and commits only the latest pending slice', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RetainedProjectionViewportFactory } = await import('/src/rendering/retained-projection-viewport.ts');
    const target = document.createElement('div');
    document.body.append(target);
    const loaded: number[] = [];
    let releaseFive!: () => void;
    const five = new Promise<void>((resolve) => { releaseFive = resolve; });
    const source = {
      async getDisplaySliceInventories() { throw new Error('not used'); },
      async loadSlice(axis: 'coronal' | 'sagittal' | 'horizontal', sliceIndex: number) {
        loaded.push(sliceIndex);
        if (sliceIndex === 5) await five;
        return {
          axis,
          sliceIndex,
          worldCoordinateUm: sliceIndex * 10,
          viewBox: { x: 0, y: 0, width: 2, height: 2 },
          svgFragment: `<path data-allen-id="-10" data-beryl-id="-20" data-cosmos-id="-30" d="M${sliceIndex} 0Z"/>`,
        };
      },
      async guidesForWorld() { return []; },
      async prefetchNeighbor() {},
      dispose() {},
    };
    const factory = new RetainedProjectionViewportFactory({ source });
    const viewport = factory.create(target, 'coronal');
    const model = (sliceIndex: number) => ({
      axis: 'coronal' as const,
      sliceIndex,
      cursor: { xUm: 0, yUm: 0, zUm: 0 },
      parcellation: 'allen' as const,
      feature: null,
    });
    await viewport.render(model(4));
    const requests = [viewport.render(model(5)), viewport.render(model(6)), viewport.render(model(7))];
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    releaseFive();
    await Promise.all(requests);
    return { loaded, assetIndex: target.dataset.assetIndex };
  });
  expect(result).toEqual({ loaded: [4, 7], assetIndex: '7' });
});

test('retained viewport aborts obsolete geometry before loading the latest slice', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RetainedProjectionViewportFactory } = await import('/src/rendering/retained-projection-viewport.ts');
    const target = document.createElement('div');
    document.body.append(target);
    const aborted: number[] = [];
    const source = {
      async getDisplaySliceInventories() { throw new Error('not used'); },
      async loadSlice(
        axis: 'coronal' | 'sagittal' | 'horizontal',
        sliceIndex: number,
        signal?: AbortSignal,
      ) {
        if (sliceIndex === 5) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, 5_000);
            signal?.addEventListener('abort', () => {
              window.clearTimeout(timer);
              aborted.push(sliceIndex);
              reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          });
        }
        return {
          axis,
          sliceIndex,
          worldCoordinateUm: sliceIndex * 10,
          viewBox: { x: 0, y: 0, width: 2, height: 2 },
          svgFragment: `<path data-allen-id="-10" data-beryl-id="-20" data-cosmos-id="-30" d="M${sliceIndex} 0Z"/>`,
        };
      },
      async guidesForWorld() { return []; },
      async prefetchNeighbor() {},
      dispose() {},
    };
    const factory = new RetainedProjectionViewportFactory({ source });
    const viewport = factory.create(target, 'coronal');
    const model = (sliceIndex: number) => ({
      axis: 'coronal' as const,
      sliceIndex,
      cursor: { xUm: 0, yUm: 0, zUm: 0 },
      parcellation: 'allen' as const,
      feature: null,
    });
    await viewport.render(model(4));
    const obsolete = viewport.render(model(5)).catch((error: DOMException) => error.name);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const latest = viewport.render(model(6));
    const obsoleteResult = await obsolete;
    await latest;
    return { aborted, obsoleteResult, assetIndex: target.dataset.assetIndex };
  });
  expect(result).toEqual({ aborted: [5], obsoleteResult: 'AbortError', assetIndex: '6' });
});
