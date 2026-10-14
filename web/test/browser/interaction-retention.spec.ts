import { expect, test } from '@playwright/test';

// Assert retained work boundaries, rather than machine-dependent timing budgets.
test('selection retains tree values, search highlights, folds and keyboard focus', async ({ page }) => {
  await page.goto('/app/?v=4&autoslice=0');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(8);
  await page.getByLabel('Search brain regions').fill('mediodorsal');
  const button = page.locator('[data-region-button="-362"]');
  await button.focus();
  const result = await page.evaluate(async () => {
    const list = document.querySelector('.region-list')!;
    const elements = [...list.querySelectorAll('*')];
    const focus = document.activeElement;
    const folds = [...list.querySelectorAll('[aria-expanded]')].map(node => node.getAttribute('aria-expanded'));
    const count = document.querySelector('.region-search__count')!.textContent;
    const scrollTop = list.scrollTop;
    let childMutations = 0;
    const observer = new MutationObserver(records => { childMutations += records.length; });
    observer.observe(list, { childList: true, subtree: true });
    const select = (id: string, additive = false) => {
      document.querySelector(`[data-region-button="${id}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: additive }));
    };
    select('-362'); select('-68', true); select('-362', true);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    observer.disconnect();
    return { childMutations,
      retainedElements: elements.every((node, index) => node === list.querySelectorAll('*')[index]),
      retainedFocus: focus === document.activeElement,
      retainedFolds: JSON.stringify(folds) === JSON.stringify([...list.querySelectorAll('[aria-expanded]')].map(node => node.getAttribute('aria-expanded'))),
      retainedCount: count === document.querySelector('.region-search__count')!.textContent,
      retainedScroll: scrollTop === list.scrollTop,
      selected: new URL(location.href).searchParams.get('selected') };
  });
  expect(result).toEqual({ childMutations: 0, retainedElements: true, retainedFocus: true,
    retainedFolds: true, retainedCount: true, retainedScroll: true, selected: '-68' });
  await expect(page.locator('.region-row[data-region-id="-68"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-region-button="-68"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('ready hover updates linked feedback without full renders, recoloring or rebuilding guides', async ({ page }) => {
  await page.goto('/app/?v=4&scale=linear&dist=full');
  const source = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  await expect(source).toHaveCSS('fill', 'rgb(44, 114, 142)');
  const result = await page.evaluate(async () => {
    const modules = [await import('/src/app.ts'), await import('/src/ui/app-shell.ts'),
      await import('/src/ui/regional/controller.ts'), await import('/src/rendering/svg-slice-renderer.ts')];
    const calls: Record<string, number> = {};
    const restore: (() => void)[] = [];
    for (const module of modules) for (const [name, value] of Object.entries(module)) {
      const prototype = (value as any)?.prototype;
      if (typeof prototype?.render !== 'function') continue;
      const original = prototype.render;
      calls[name] = 0;
      prototype.render = function(...args: unknown[]) { calls[name]! += 1; return original.apply(this, args); };
      restore.push(() => { prototype.render = original; });
    }
    const guides = [...document.querySelectorAll('.slice-guide')];
    const styles = [...document.querySelectorAll('[data-slice-asset] path')].map(path => path.getAttribute('style'));
    const url = location.href;
    const source = document.querySelector('[data-view="coronal"] path[data-allen-id="-362"]')!;
    const other = [...document.querySelectorAll('[data-view="coronal"] path[data-allen-id]')].find(path => {
      const id = String(-Math.abs(Number(path.getAttribute('data-allen-id'))));
      return id !== '-362' && document.querySelector(`.region-row[data-region-id="${id}"]`);
    })!;
    const otherId = String(-Math.abs(Number(other.getAttribute('data-allen-id'))));
    const ids: string[] = [];
    try {
      for (const path of [source, other]) {
        path.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        ids.push(document.querySelector('.region-row[data-hovered="true"]')!.getAttribute('data-region-id')!);
      }
      document.querySelector('[data-view="coronal"] .view-frame__slice-figure')!.dispatchEvent(new PointerEvent('pointerleave'));
      return { calls, ids, otherId, retainedGuides: guides.every((node, index) => node === document.querySelectorAll('.slice-guide')[index]),
        retainedStyles: JSON.stringify(styles) === JSON.stringify([...document.querySelectorAll('[data-slice-asset] path')].map(path => path.getAttribute('style'))),
        unchangedUrl: url === location.href, highlighted: document.querySelectorAll('path.is-highlighted').length,
        hoveredRows: document.querySelectorAll('.region-row[data-hovered]').length };
    } finally { restore.forEach(callback => callback()); }
  });
  expect(result).toEqual({ calls: { AtlasApp: 0, AppShell: 0, RegionalPanelController: 0, SvgSliceRenderer: 0 },
    ids: ['-362', result.otherId], otherId: result.otherId, retainedGuides: true, retainedStyles: true, unchangedUrl: true, highlighted: 0, hoveredRows: 0 });
});

test('volume hover retains scalar pixels without repainting the canvas', async ({ page }) => {
  await page.goto('/app/?v=4&feature=rms_ap&repr=volume&cursor=25,25,25');
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  await expect(page.locator('[data-region-button="-362"]')).toHaveCount(1);
  const result = await page.evaluate(async () => {
    const { CanvasVolumeSliceRenderer } = await import('/src/rendering/canvas-volume-renderer.ts');
    const original = CanvasVolumeSliceRenderer.prototype.render;
    let paints = 0;
    CanvasVolumeSliceRenderer.prototype.render = function(frame) { paints++; return original.call(this, frame); };
    try {
      const button = document.querySelector('[data-region-button="-362"]')!;
      button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      const hovered = document.querySelector('.region-row[data-hovered="true"]')?.getAttribute('data-region-id');
      button.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
      return { paints, hovered };
    } finally { CanvasVolumeSliceRenderer.prototype.render = original; }
  });
  expect(result).toEqual({ paints: 0, hovered: '-362' });
});
