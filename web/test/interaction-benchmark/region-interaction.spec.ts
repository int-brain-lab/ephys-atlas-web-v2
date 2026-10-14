import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

function summarize(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return { n: sorted.length, p50_ms: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1], max_ms: sorted.at(-1) };
}

test('warm real-data slice hover and selection through the complete application', async ({ page, browser }) => {
  const trials = [];
  for (let trial = 0; trial < 3; trial++) {
    await page.goto('/app/');
    await expect(page.locator('.region-pane')).toHaveAttribute('data-fixture', 'false');
    await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
    await expect(page.locator('.distribution-chart__global')).toHaveCount(1);
    // Let initial browser layout settle; this benchmark measures warm interactions.
    await page.waitForTimeout(500);
    const points = await page.evaluate(() => {
      const bounds = document.querySelector('[data-slice-asset="projection-pack-v1"]')!.getBoundingClientRect();
      const seen = new Set<string>();
      const points = [];
      for (let y = bounds.top + 10; y < bounds.bottom - 10; y += 13) {
        for (let x = bounds.left + 10; x < bounds.right - 10; x += 13) {
          const path = document.elementFromPoint(x, y);
          const id = path?.getAttribute('data-allen-id');
          if (!id) continue;
          const logicalId = String(-Math.abs(Number(id)));
          if (seen.has(logicalId)) continue;
          seen.add(logicalId);
          points.push({ x, y, id, complexity: path!.getAttribute('d')!.length });
        }
      }
      const state = { phase: 'hover', events: [] as { type: string; id: string; start: number;
        handlerMs?: number; twoRafMs?: number; trusted: boolean }[], longTasks: [] as number[] };
      (window as any).interactionBenchmark = state;
      const samples = new WeakMap<Event, typeof state.events[number]>();
      for (const type of ['pointermove', 'pointerup']) {
        document.addEventListener(type, event => {
          if (type === 'pointermove' && state.phase !== 'hover') return;
          const id = (event.target as Element).getAttribute('data-allen-id');
          if (!id) return;
          const sample = { type, id, start: performance.now(), trusted: event.isTrusted };
          state.events.push(sample);
          samples.set(event, sample);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            (sample as typeof state.events[number]).twoRafMs = performance.now() - sample.start;
          }));
        }, true);
        document.addEventListener(type, event => {
          const sample = samples.get(event);
          if (sample) sample.handlerMs = performance.now() - sample.start;
        });
      }
      new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => entry.duration)))
        .observe({ type: 'longtask' });
      return points.sort((a, b) => b.complexity - a.complexity).slice(0, 20);
    });
    expect(points.length).toBeGreaterThanOrEqual(10);
    for (const point of points) {
      await page.evaluate(() => { (window as any).interactionBenchmark.phase = 'hover'; });
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(80);
      await page.evaluate(() => { (window as any).interactionBenchmark.phase = 'click'; });
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(150);
      await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toBe(String(-Math.abs(Number(point.id))));
    }
    const result = await page.evaluate(() => ({ url: location.href,
      ...((window as any).interactionBenchmark as { events: { type: string; handlerMs: number; twoRafMs: number; trusted: boolean }[]; longTasks: number[] }) }));
    expect(result.events.filter(event => event.type === 'pointerup')).toHaveLength(points.length);
    expect(result.events.every(event => event.trusted && Number.isFinite(event.handlerMs) && Number.isFinite(event.twoRafMs))).toBe(true);
    trials.push({ ...result, points });
  }
  const events = trials.flatMap(trial => trial.events);
  const report = { environment: { browser: browser.version(), platform: os.platform(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, viewport: page.viewportSize(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    bundle: 'data/development-bundle-v7.json', maturity: 'local-real-data',
    metric: 'capture-to-bubble handler duration; two rAF callbacks are a frame proxy, not exact presentation latency' },
    summary: Object.fromEntries(['pointermove', 'pointerup'].map(type => {
      const samples = events.filter(event => event.type === type);
      return [type, { handler: summarize(samples.map(sample => sample.handlerMs)),
        frame_proxy: summarize(samples.map(sample => sample.twoRafMs)) }];
    })), longTasks: summarize(trials.flatMap(trial => trial.longTasks)), trials };
  console.log(JSON.stringify(report.summary));
  const output = process.env.EPHYS_ATLAS_INTERACTION_BENCHMARK_OUTPUT;
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
});
