import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';

const manifestUrl = '/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/manifest.json';
const trials = 5;
const output = process.env.EPHYS_ATLAS_ANATOMY_BENCHMARK_OUTPUT;
const cases = [
  { axis: 'coronal', sliceIndex: 809, samePackIndex: 813, label: 'coronal-p95' },
  { axis: 'sagittal', sliceIndex: 605, samePackIndex: 601, label: 'sagittal-p95' },
  { axis: 'horizontal', sliceIndex: 343, samePackIndex: 347, label: 'horizontal-p95' },
  { axis: 'horizontal', sliceIndex: 400, samePackIndex: 404, label: 'horizontal-max' },
] as const;

function timing(values: number[]): { p50_ms: number; p95_ms: number; samples_ms: number[] } {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50_ms: sorted[Math.floor((sorted.length - 1) * 0.5)]!,
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    samples_ms: values,
  };
}

test('cold anatomy packs expose browser pipeline timings', async ({ page, browserName }) => {
  await page.goto('/');
  await expect(page.locator('[data-slice-asset="generated-anatomy-v2"]')).toHaveCount(3);

  const measurements = await page.evaluate(async ({ cases, manifestUrl, trials }) => {
    const [{ GeneratedAnatomySliceSource }, { GeneratedAnatomySliceRenderer }] = await Promise.all([
      import('/src/rendering/generated-anatomy-source.ts'),
      import('/src/rendering/generated-anatomy-renderer.ts'),
    ]);
    const results = [];
    const memory = () => (performance as Performance & {
      memory?: { usedJSHeapSize: number };
    }).memory?.usedJSHeapSize ?? null;
    document.body.replaceChildren();

    for (const benchmarkCase of cases) {
      const samples = [];
      for (let trial = 0; trial < trials; trial += 1) {
        type PhaseEvent = { phase: string; durationMs: number; pathCount?: number };
        const sourceEvents: PhaseEvent[] = [];
        const svgEvents: PhaseEvent[] = [];
        const longTasks: { start: number; duration: number }[] = [];
        const frameGaps: number[] = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
        });
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ entryTypes: ['longtask'] });

        const fetchImpl: typeof fetch = (input, init) => {
          const rawUrl = typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
          const url = new URL(rawUrl, location.href);
          if (url.pathname.endsWith('.json.gz')) url.searchParams.set('anatomy-benchmark', `${benchmarkCase.label}-${trial}`);
          return fetch(url, { ...init, cache: 'no-store' });
        };
        const source = new GeneratedAnatomySliceSource({
          manifestUrl,
          packDepth: 16,
          fetchImpl,
          scheduleIdle: () => undefined,
          onPerformance: (event) => sourceEvents.push(event),
        });
        const renderer = new GeneratedAnatomySliceRenderer(source, {
          onPerformance: (event) => svgEvents.push(event),
        });
        const target = document.createElement('div');
        target.style.cssText = 'width:640px;height:480px';
        document.body.append(target);
        const model = (sliceIndex: number) => ({
          axis: benchmarkCase.axis,
          sliceIndex,
          slices: { coronal: 660, sagittal: 550, horizontal: 400, [benchmarkCase.axis]: sliceIndex },
          cursor: { xUm: 0, yUm: 0, zUm: 0 },
          parcellation: 'allen' as const,
          selectedRegionIds: [],
          feature: null,
        });

        let animationFrame = 0;
        let lastFrame: number | null = null;
        let collectingFrames = true;
        const frame = (time: number) => {
          if (lastFrame != null) frameGaps.push(time - lastFrame);
          lastFrame = time;
          if (collectingFrames) animationFrame = requestAnimationFrame(frame);
        };
        animationFrame = requestAnimationFrame(frame);
        const sequenceStarted = performance.now();
        const heapBefore = memory();
        const capture = async (sliceIndex: number) => {
          sourceEvents.length = 0;
          svgEvents.length = 0;
          const started = performance.now();
          await renderer.render(target, model(sliceIndex));
          const inputToCommitMs = performance.now() - started;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return {
            inputToPaintMs: performance.now() - started,
            inputToCommitMs,
            source: [...sourceEvents],
            svg: [...svgEvents],
            finalSliceIndex: Number(target.dataset.assetIndex),
          };
        };

        const coldPack = await capture(benchmarkCase.sliceIndex);
        const samePack = await capture(benchmarkCase.samePackIndex);
        const retainedRevisit = await capture(benchmarkCase.sliceIndex);
        collectingFrames = false;
        cancelAnimationFrame(animationFrame);
        observer.disconnect();
        const heapAfter = memory();
        renderer.destroy();
        target.remove();
        samples.push({
          coldPack,
          samePack,
          retainedRevisit,
          longTasks: longTasks.filter((entry) => entry.start >= sequenceStarted),
          frameGaps,
          heapDeltaBytes: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
        });
      }
      results.push({ ...benchmarkCase, samples });
    }
    return { results, userAgent: navigator.userAgent };
  }, { cases, manifestUrl, trials });

  const report = {
    benchmark: 'anatomy-cache-miss-browser-v1',
    measured_at: new Date().toISOString(),
    trials,
    environment: {
      browser: browserName,
      user_agent: measurements.userAgent,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
      cpus: os.cpus().length,
      memory_bytes: os.totalmem(),
    },
    cases: measurements.results.map((result) => ({
      axis: result.axis,
      label: result.label,
      slice_index: result.sliceIndex,
      same_pack_index: result.samePackIndex,
      cold_pack_input_to_paint: timing(result.samples.map((sample) => sample.coldPack.inputToPaintMs)),
      cold_pack_input_to_commit: timing(result.samples.map((sample) => sample.coldPack.inputToCommitMs)),
      same_pack_input_to_paint: timing(result.samples.map((sample) => sample.samePack.inputToPaintMs)),
      same_pack_input_to_commit: timing(result.samples.map((sample) => sample.samePack.inputToCommitMs)),
      retained_revisit_input_to_paint: timing(result.samples.map((sample) => sample.retainedRevisit.inputToPaintMs)),
      retained_revisit_input_to_commit: timing(result.samples.map((sample) => sample.retainedRevisit.inputToCommitMs)),
      cold_source_phases: Object.fromEntries(
        [...new Set(result.samples.flatMap((sample) => sample.coldPack.source.map((event) => event.phase)))].map((phase) => [
          phase,
          timing(result.samples.map((sample) => sample.coldPack.source.find((event) => event.phase === phase)?.durationMs ?? 0)),
        ]),
      ),
      cold_svg_phases: Object.fromEntries(
        [...new Set(result.samples.flatMap((sample) => sample.coldPack.svg.map((event) => event.phase)))].map((phase) => [
          phase,
          timing(result.samples.map((sample) => sample.coldPack.svg.find((event) => event.phase === phase)?.durationMs ?? 0)),
        ]),
      ),
      cold_path_count: result.samples[0]?.coldPack.svg.find((event) => event.pathCount != null)?.pathCount ?? null,
      max_long_task_ms: Math.max(0, ...result.samples.flatMap((sample) => sample.longTasks.map((entry) => entry.duration))),
      max_frame_gap_ms: Math.max(0, ...result.samples.flatMap((sample) => sample.frameGaps)),
      heap_delta_bytes: result.samples.map((sample) => sample.heapDeltaBytes),
    })),
  };

  for (const result of measurements.results) {
    expect(result.samples.every((sample) => sample.coldPack.finalSliceIndex === result.sliceIndex)).toBe(true);
    expect(result.samples.every((sample) => sample.samePack.finalSliceIndex === result.samePackIndex)).toBe(true);
    expect(result.samples.every((sample) => sample.retainedRevisit.finalSliceIndex === result.sliceIndex)).toBe(true);
    expect(result.samples.every((sample) => sample.samePack.source.length === 0)).toBe(true);
    expect(result.samples.every((sample) => !sample.retainedRevisit.svg.some((event) => event.phase === 'svg-parse'))).toBe(true);
  }
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
});
