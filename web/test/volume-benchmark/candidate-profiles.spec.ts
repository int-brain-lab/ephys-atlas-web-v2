import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const configured = process.env.EPHYS_ATLAS_VOLUME_CANDIDATES?.split(',').filter(Boolean) ?? [];
const output = process.env.EPHYS_ATLAS_VOLUME_CANDIDATE_BENCHMARK_OUTPUT;

interface Resource {
  path: string;
  bytes: number;
  sha256: string;
  codec: { name: 'gzip'; decoded_bytes: number };
}

interface Pack {
  axis: 'i0' | 'i1' | 'i2';
  first_slice: number;
  slice_count: number;
  decoded: { shape: [number, number, number]; storage_axes: ['i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2'] };
  resource: Resource;
}

interface CandidateFeature {
  featureId: string;
  depth: number;
  root: string;
  grid: Record<string, unknown>;
  array: { dtype: 'float16'; endianness: 'little'; order: 'C' };
  packs: Pack[];
  centerBytes: number;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1]!;
}

async function loadCandidates(): Promise<CandidateFeature[]> {
  const result: CandidateFeature[] = [];
  for (const configuredRoot of configured) {
    const root = path.resolve(configuredRoot);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const depth = manifest.provenance.recipe.transport.pack_depth as number;
    for (const entry of manifest.features as { id: string }[]) {
      const featureRoot = path.join(root, 'features', entry.id);
      const feature = JSON.parse(await readFile(path.join(featureRoot, 'feature.json'), 'utf8'));
      const volume = feature.representations.volume;
      const index = JSON.parse(await readFile(path.join(
        featureRoot,
        volume.encoding.resource_index.resource.path,
      ), 'utf8'));
      const centers = [115, 108, 7];
      const centerPacks = centers.map((center, dimension) => index.packs.find((pack: Pack) => (
        pack.axis === `i${dimension}`
        && pack.first_slice <= center
        && center < pack.first_slice + pack.slice_count
      )) as Pack);
      result.push({
        featureId: entry.id,
        depth,
        root: featureRoot,
        grid: volume.grid,
        array: volume.array,
        packs: index.packs,
        centerBytes: centerPacks.reduce((sum, pack) => sum + pack.resource.bytes, 0),
      });
    }
  }
  return result;
}

test('worst-case W26 features under simulated delivery profiles', async ({ page, browserName }) => {
  test.skip(configured.length !== 2, 'set EPHYS_ATLAS_VOLUME_CANDIDATES to depth-4,depth-8 releases');
  const candidates = await loadCandidates();
  const depths = [...new Set(candidates.map((candidate) => candidate.depth))].sort();
  expect(depths).toEqual([4, 8]);
  const worstFeatureIds = [...new Set(
    depths.flatMap((depth) => candidates
      .filter((candidate) => candidate.depth === depth)
      .sort((left, right) => right.centerBytes - left.centerBytes || left.featureId.localeCompare(right.featureId))
      .slice(0, 6)
      .map((candidate) => candidate.featureId)),
  )];
  expect(worstFeatureIds).not.toEqual(expect.arrayContaining(['psd_lfp', 'rms_ap', 'polarity']));

  const resources = new Map<string, { file: string; bytes: number }>();
  for (const candidate of candidates) {
    for (const pack of candidate.packs) {
      resources.set(`${candidate.depth}/${candidate.featureId}/${pack.resource.path}`, {
        file: path.join(candidate.root, pack.resource.path),
        bytes: pack.resource.bytes,
      });
    }
  }
  let activeProfile = { latencyMs: 0, bitsPerSecond: Number.POSITIVE_INFINITY };
  let requestLog: { key: string; bytes: number }[] = [];
  await page.route('**/__candidate_benchmark__/**', async (route) => {
    const marker = '/__candidate_benchmark__/';
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const key = pathname.slice(pathname.indexOf(marker) + marker.length);
    const descriptor = resources.get(key);
    if (!descriptor) return route.fulfill({ status: 404, body: 'undeclared candidate resource' });
    requestLog.push({ key, bytes: descriptor.bytes });
    const transferMs = Number.isFinite(activeProfile.bitsPerSecond)
      ? descriptor.bytes * 8 * 1000 / activeProfile.bitsPerSecond
      : 0;
    await new Promise((resolve) => setTimeout(resolve, activeProfile.latencyMs + transferMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
      body: await readFile(descriptor.file),
    });
  });
  await page.goto('/');

  const profiles = [
    { id: 'local', latencyMs: 0, bitsPerSecond: Number.POSITIVE_INFINITY },
    { id: 'broadband-100mbps-20ms', latencyMs: 20, bitsPerSecond: 100_000_000 },
    { id: 'constrained-10mbps-80ms', latencyMs: 80, bitsPerSecond: 10_000_000 },
  ];
  const rows = [];
  let run = 0;
  for (const profile of profiles) {
    activeProfile = profile;
    for (const featureId of worstFeatureIds) {
      for (const depth of depths) {
        const candidate = candidates.find((item) => item.depth === depth && item.featureId === featureId)!;
        const samples = [];
        for (let trial = 0; trial < 3; trial += 1) {
          requestLog = [];
          run += 1;
          const metrics = await page.evaluate(async ({ candidate, run }) => {
            const [{ SchemaSlicePackVolumeSource }, { CanvasVolumeSliceRenderer }] = await Promise.all([
              import('/src/rendering/slice-pack-volume-source.ts'),
              import('/src/rendering/canvas-volume-renderer.ts'),
            ]);
            const fetchDurations: number[] = [];
            const resource = {
              pack_depth: candidate.depth,
              packs: candidate.packs.map((pack) => ({
                axis: pack.axis,
                firstSlice: pack.first_slice,
                sliceCount: pack.slice_count,
                decoded: { shape: pack.decoded.shape, storageAxes: pack.decoded.storage_axes },
                resource: {
                  path: pack.resource.path,
                  mediaType: 'application/octet-stream',
                  bytes: pack.resource.bytes,
                  sha256: pack.resource.sha256,
                  codec: { name: 'gzip', decodedBytes: pack.resource.codec.decoded_bytes },
                },
              })),
            };
            const payload = {
              schemaVersion: '1.0' as const,
              featureId: candidate.featureId,
              representation: 'volume' as const,
              descriptor: {
                kind: 'volume' as const,
                format: 'ephys-atlas-volume-v1' as const,
                layout: 'orthogonal_slice_packs' as const,
                grid: {
                  shape: candidate.grid.shape,
                  axisOrder: ['ml', 'ap', 'dv'] as const,
                  coordinateSystem: 'D043 W26 benchmark',
                  referenceSpaceId: candidate.grid.reference_space_id,
                  gridId: candidate.grid.grid_id,
                  voxelSizeUm: [50, 50, 50] as const,
                  originUm: [-5739, 5400, 332] as const,
                  indexToWorldUm: candidate.grid.index_to_world_um,
                  worldToIndex: candidate.grid.world_to_index,
                  voxelEdgeExtentUm: candidate.grid.voxel_edge_extent_um,
                },
                array: { dtype: 'float16' as const, endianness: 'little' as const, order: 'C' as const },
                resource,
              },
              async loadResource(resourcePath: string): Promise<ArrayBuffer> {
                const started = performance.now();
                const response = await fetch(
                  `/__candidate_benchmark__/${candidate.depth}/${candidate.featureId}/${resourcePath}?run=${run}`,
                );
                const buffer = await response.arrayBuffer();
                fetchDurations.push(performance.now() - started);
                return buffer;
              },
            };
            const source = new SchemaSlicePackVolumeSource(payload as never);
            const axes = ['coronal', 'sagittal', 'horizontal'] as const;
            const indices = [108, 115, 7] as const;
            const heapBefore = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
            const coldStarted = performance.now();
            const slices = await Promise.all(axes.map((axis, index) => source.loadSlice(axis, indices[index]!)));
            const coldMs = performance.now() - coldStarted;
            const requestsBeforeCached = fetchDurations.length;
            const cachedStarted = performance.now();
            await Promise.all(axes.map((axis, index) => source.loadSlice(axis, indices[index]!)));
            const cachedMs = performance.now() - cachedStarted;
            const canvases = slices.map(() => document.createElement('canvas'));
            const paintStarted = performance.now();
            slices.forEach((slice, index) => {
              const rgba = new Uint8ClampedArray(slice.data.length * 4);
              rgba.fill(255);
              new CanvasVolumeSliceRenderer(canvases[index]!).render({ ...slice, rgba });
            });
            const paintMs = performance.now() - paintStarted;
            const heapAfter = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
            source.dispose();
            return {
              coldMs,
              cachedMs,
              paintMs,
              fetchMs: Math.max(...fetchDurations),
              coldDecodePlaneEstimateMs: Math.max(0, coldMs - Math.max(...fetchDurations)),
              coldRequests: requestsBeforeCached,
              cachedRequests: fetchDurations.length - requestsBeforeCached,
              heapDeltaBytes: heapBefore === undefined || heapAfter === undefined ? null : heapAfter - heapBefore,
            };
          }, { candidate, run });
          const coldBytes = requestLog.reduce((sum, request) => sum + request.bytes, 0);
          samples.push({ ...metrics, coldBytes });
        }
        rows.push({
          profile: profile.id,
          feature_id: featureId,
          depth,
          cold_requests: samples[0]!.coldRequests,
          cached_requests: samples[0]!.cachedRequests,
          cold_bytes: samples[0]!.coldBytes,
          cold_ms_p50: percentile(samples.map((sample) => sample.coldMs), 0.5),
          cold_ms_p95: percentile(samples.map((sample) => sample.coldMs), 0.95),
          decode_plane_estimate_ms_p50: percentile(samples.map((sample) => sample.coldDecodePlaneEstimateMs), 0.5),
          cached_ms_p50: percentile(samples.map((sample) => sample.cachedMs), 0.5),
          paint_ms_p50: percentile(samples.map((sample) => sample.paintMs), 0.5),
          decoded_cache_bytes: candidate.packs
            .filter((pack) => [115, 108, 7].some((center, dimension) => (
              pack.axis === `i${dimension}`
              && pack.first_slice <= center
              && center < pack.first_slice + pack.slice_count
            )))
            .reduce((sum, pack) => sum + pack.resource.codec.decoded_bytes * 2, 0),
          heap_delta_bytes_p50: samples[0]!.heapDeltaBytes === null
            ? null
            : percentile(samples.map((sample) => sample.heapDeltaBytes ?? 0), 0.5),
        });
      }
    }
  }
  expect(rows.every((row) => row.cold_requests === 3 && row.cached_requests === 0)).toBe(true);
  const report = {
    benchmark: 'w26-volume-candidate-browser-profiles-v1',
    measured_at: new Date().toISOString(),
    environment: {
      browser: browserName,
      user_agent: await page.evaluate(() => navigator.userAgent),
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
    },
    profiles,
    worst_feature_ids: worstFeatureIds,
    trials: 3,
    rows,
    limitations: [
      'Latency and bandwidth are simulated in Playwright route fulfillment; this is not eventual CDN validation.',
      'decode_plane_estimate_ms subtracts the longest parallel fetch from cold wall time.',
      'decoded_cache_bytes accounts for float16-to-float32 expansion in the three resident center packs.',
    ],
  };
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
});
