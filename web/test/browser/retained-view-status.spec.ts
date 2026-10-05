import { expect, test } from '@playwright/test';

test('retained view status keeps the delayed cue through guide-only superseding requests', async ({ page }) => {
  await page.goto('/app/');
  const requests = await page.evaluate(async () => {
    const { RetainedViewStatus } = await import('/src/ui/retained-view-status.ts');
    const frame = document.createElement('section');
    frame.dataset.retainedStatusTest = '';
    const header = document.createElement('div');
    header.dataset.retainedStatusHeader = '';
    document.body.append(frame, header);
    const controller = new RetainedViewStatus(frame, frame, header);
    frame.append(controller.initialStatus.element, controller.updateStatus.element);
    const content = {
      datasetId: 'test-dataset', releaseId: 'release-1', representation: 'regional',
      featureRepresentation: 'regional', featureId: 'feature-1', parcellation: 'allen',
    } as const;
    const request = (sliceIndex: number, xUm: number, coordinate: string) => ({
      kind: 'slice' as const, content, axis: 'coronal' as const, sliceIndex,
      cursor: { xUm, yUm: 20, zUm: 30 }, coordinate,
    });
    const ready = controller.begin(request(4, 10, 'ML 10 µm'))!;
    controller.pending('slice', false, { state: 'loading', title: 'Loading registered anatomy…' });
    controller.complete(ready.token);

    const adjacent = request(5, 11, 'ML 11 µm');
    const first = controller.begin(adjacent)!;
    controller.pending('slice', true, {
      state: 'loading', title: 'Loading slice…', detail: 'Showing the previous slice (ML 10 µm).',
    }, true);
    // A linked-guide update changes the cursor and render token while retaining
    // the same slice geometry. The existing progress deadline must keep running.
    const latest = controller.begin(request(5, 12, 'ML 12 µm'))!;
    (window as Window & { __retainedViewStatus?: { controller: typeof controller; staleToken: number; currentToken: number } })
      .__retainedViewStatus = { controller, staleToken: first.token, currentToken: latest.token };
    return { oldCoordinate: controller.displayedRequest?.kind === 'slice' ? controller.displayedRequest.coordinate : null };
  });

  const frame = page.locator('[data-retained-status-test]');
  const status = frame.locator('.operation-status[data-variant="compact"]');
  await expect(frame).toHaveAttribute('aria-busy', 'true');
  await expect(frame).toHaveAttribute('data-slice-progress', 'true');
  await expect(status).toContainText('Loading slice…');
  await expect(status).toContainText('Showing the previous slice (ML 10 µm).');

  const staleCompleted = await page.evaluate(() => {
    const state = (window as Window & { __retainedViewStatus?: {
      controller: { complete(token: number): boolean; displayedRequest: { coordinate: string } | null };
      staleToken: number;
    } }).__retainedViewStatus!;
    return { completed: state.controller.complete(state.staleToken), displayed: state.controller.displayedRequest?.coordinate ?? null };
  });
  expect(staleCompleted).toEqual({ completed: false, displayed: requests.oldCoordinate });
  await expect(frame).toHaveAttribute('aria-busy', 'true');
  await expect(frame).toHaveAttribute('data-slice-progress', 'true');

  const currentCompleted = await page.evaluate(() => {
    const state = (window as Window & { __retainedViewStatus?: {
      controller: { complete(token: number): boolean; displayedRequest: { coordinate: string } | null };
      currentToken: number;
    } }).__retainedViewStatus!;
    const completed = state.controller.complete(state.currentToken);
    return { completed, displayed: state.controller.displayedRequest?.coordinate ?? null };
  });
  expect(currentCompleted).toEqual({ completed: true, displayed: 'ML 12 µm' });
  await expect(frame).toHaveAttribute('aria-busy', 'false');
  await expect(frame).not.toHaveAttribute('data-slice-progress', 'true');
  await expect(status).toBeHidden();
  await page.locator('[data-retained-status-header]').evaluate((node) => node.remove());
  await frame.evaluate((node) => node.remove());
});

test('retry can begin the same failed request again and disposal cancels delayed feedback', async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(async () => {
    const { RetainedViewStatus } = await import('/src/ui/retained-view-status.ts');
    const frame = document.createElement('section');
    frame.dataset.retainedStatusDisposeTest = '';
    const header = document.createElement('div');
    document.body.append(frame, header);
    const controller = new RetainedViewStatus(frame, frame, header);
    const request = {
      kind: 'slice' as const,
      content: {
        datasetId: 'test-dataset', releaseId: 'release-1', representation: 'regional' as const,
        featureRepresentation: 'regional' as const, featureId: 'feature-1', parcellation: 'allen' as const,
      },
      axis: 'coronal' as const, sliceIndex: 7,
      cursor: { xUm: 10, yUm: 20, zUm: 30 }, coordinate: 'ML 10 µm',
    };
    const failed = controller.begin(request)!;
    controller.pending('slice', true, { state: 'loading', title: 'Loading slice…' });
    controller.error('slice', true, { state: 'error', title: 'Couldn’t load this view', detail: 'Please try again.' });
    controller.invalidate();
    const retry = controller.begin(request)!;
    if (retry.token === failed.token) throw new Error('Retry reused the failed request token');
    controller.pending('slice', true, { state: 'loading', title: 'Loading slice…' });
    controller.complete(retry.token);

    const later = controller.begin({ ...request, sliceIndex: 8, coordinate: 'ML 12 µm' })!;
    controller.pending('slice', true, {
      state: 'loading', title: 'Loading slice…', detail: 'Showing the previous slice (ML 10 µm).',
    }, true);
    controller.dispose();
    (window as Window & { __retainedViewDisposeTest?: { controller: typeof controller; token: number } })
      .__retainedViewDisposeTest = { controller, token: later.token };
  });

  const frame = page.locator('[data-retained-status-dispose-test]');
  await page.waitForTimeout(250);
  await expect(frame).not.toHaveAttribute('data-slice-progress', 'true');
  await expect(frame).not.toHaveAttribute('data-updating');
  await expect(frame).toHaveAttribute('aria-busy', 'false');
  await expect(frame.locator('.operation-status')).toBeHidden();
  const completedAfterDispose = await page.evaluate(() => {
    const state = (window as Window & { __retainedViewDisposeTest?: { controller: { complete(token: number): boolean }; token: number } })
      .__retainedViewDisposeTest!;
    return state.controller.complete(state.token);
  });
  expect(completedAfterDispose).toBe(false);
  await frame.evaluate((node) => node.remove());
});
