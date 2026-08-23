import { expect, test } from '@playwright/test';
import { readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface LayoutManifest {
  depth: number;
  shape: [number, number, number];
  axis_order: [string, string, string];
  centers: [number, number, number];
  warm_indices: [number, number, number];
  boundary_indices: [number, number, number];
  resource: Record<string, unknown>;
  files: { path: string; raw_bytes: number; gzip_bytes: number }[];
}

interface ArtifactManifest {
  benchmark: string;
  feature_id: string;
  feature_index: number;
  resolution_um: number;
  axis_semantics: string;
  source: { path: string; bytes: number; sha256: string };
  layouts: LayoutManifest[];
}

function timing(values: number[]): { p50_ms: number; p95_ms: number; samples_ms: number[] } {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50_ms: sorted[Math.floor((sorted.length - 1) * 0.5)]!,
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    samples_ms: values,
  };
}

const artifactRoot = process.env.EPHYS_ATLAS_VOLUME_BENCHMARK_DIR;
const output = process.env.EPHYS_ATLAS_VOLUME_BENCHMARK_OUTPUT;
const trials = 10;

test('real slice packs meet the request/cache path in Chromium', async ({ page, browserName }) => {
  test.skip(!artifactRoot, 'set EPHYS_ATLAS_VOLUME_BENCHMARK_DIR to generated real artifacts');
  const manifest = JSON.parse(await readFile(path.join(artifactRoot!, 'benchmark-manifest.json'), 'utf8')) as ArtifactManifest;
  const declared = new Map(manifest.layouts.flatMap((layout) => layout.files.map((file) => [file.path, file])));
  let requests: { path: string; bytes: number }[] = [];
  await page.route('**/__volume_benchmark__/**', async (route) => {
    const marker = '/__volume_benchmark__/';
    const pathname = new URL(route.request().url()).pathname;
    const relative = decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length));
    const descriptor = declared.get(relative);
    if (!descriptor) return route.fulfill({ status: 404, body: 'undeclared benchmark object' });
    const resolved = path.resolve(artifactRoot!, relative);
    if (!resolved.startsWith(`${path.resolve(artifactRoot!)}${path.sep}`)) return route.fulfill({ status: 403 });
    const body = await readFile(resolved);
    requests.push({ path: relative, bytes: body.byteLength });
    await route.fulfill({ status: 200, contentType: 'application/gzip', headers: { 'cache-control': 'no-store' }, body });
  });
  await page.goto('/');

  const layouts = [];
  let userAgent = '';
  for (const layout of manifest.layouts) {
    requests = [];
    const metrics = await page.evaluate(async ({ featureId, layout, resolutionUm }) => {
      const [{ SchemaSlicePackVolumeSource }, { CanvasVolumeSliceRenderer }] = await Promise.all([
        import('/src/rendering/slice-pack-volume-source.ts'),
        import('/src/rendering/canvas-volume-renderer.ts'),
      ]);
      const axes = ['coronal', 'sagittal', 'horizontal'] as const;
      const payload = {
        schemaVersion: '1.0' as const,
        featureId,
        representation: 'volume' as const,
        descriptor: {
          kind: 'volume' as const,
          format: 'ephys-atlas-volume-v1' as const,
          layout: 'orthogonal_slice_packs' as const,
          grid: {
            shape: layout.shape,
            axisOrder: layout.axis_order,
            coordinateSystem: 'transport benchmark; not scientific geometry',
            referenceSpaceId: 'transport-benchmark',
            gridId: `transport-benchmark-${layout.depth}`,
            voxelSizeUm: [resolutionUm, resolutionUm, resolutionUm] as const,
            originUm: [0, 0, 0] as const,
            indexToWorldUm: [0, resolutionUm, 0, 0, resolutionUm, 0, 0, 0, 0, 0, resolutionUm, 0, 0, 0, 0, 1],
            worldToIndex: [0, 1 / resolutionUm, 0, 0, 1 / resolutionUm, 0, 0, 0, 0, 0, 1 / resolutionUm, 0, 0, 0, 0, 1],
            voxelEdgeExtentUm: [
              -resolutionUm / 2,
              layout.shape[1] * resolutionUm - resolutionUm / 2,
              -resolutionUm / 2,
              layout.shape[0] * resolutionUm - resolutionUm / 2,
              -resolutionUm / 2,
              layout.shape[2] * resolutionUm - resolutionUm / 2,
            ] as const,
          },
          array: { dtype: 'float16' as const, endianness: 'little' as const, order: 'C' as const },
          resource: layout.resource,
        },
        async loadResource(resourcePath: string): Promise<ArrayBuffer> {
          const response = await fetch(`/__volume_benchmark__/${resourcePath}`);
          if (!response.ok) throw new Error(`benchmark resource ${resourcePath}: HTTP ${response.status}`);
          return response.arrayBuffer();
        },
      };
      const samples = [];
      let initialPixels = 0;
      for (let trial = 0; trial < 10; trial += 1) {
        const source = new SchemaSlicePackVolumeSource(payload);
        const initialStarted = performance.now();
        const initial = await Promise.all(axes.map((axis, index) => source.loadSlice(axis, layout.centers[index]!)));
        const initialMs = performance.now() - initialStarted;
        const warmStarted = performance.now();
        await Promise.all(axes.map((axis, index) => source.loadSlice(axis, layout.warm_indices[index]!)));
        const warmMs = performance.now() - warmStarted;
        const boundaryStarted = performance.now();
        const boundary = await Promise.all(axes.map((axis, index) => source.loadSlice(axis, layout.boundary_indices[index]!)));
        const boundaryMs = performance.now() - boundaryStarted;
        const canvases = [...initial, ...boundary].map(() => document.createElement('canvas'));
        const paintStarted = performance.now();
        [...initial, ...boundary].forEach((slice, index) => {
          const rgba = new Uint8ClampedArray(slice.data.length * 4);
          for (let value = 0; value < slice.data.length; value += 1) {
            const offset = value * 4;
            const byte = Number.isFinite(slice.data[value]!) ? Math.max(0, Math.min(255, Math.round(slice.data[value]!))) : 0;
            rgba[offset] = byte;
            rgba[offset + 1] = byte;
            rgba[offset + 2] = byte;
            rgba[offset + 3] = Number.isFinite(slice.data[value]!) ? 255 : 0;
          }
          new CanvasVolumeSliceRenderer(canvases[index]!).render({
            axis: slice.axis,
            index: slice.index,
            width: slice.width,
            height: slice.height,
            rgba,
          });
        });
        samples.push({ initialMs, warmMs, boundaryMs, paintSixPlanesMs: performance.now() - paintStarted });
        initialPixels = initial.reduce((total, slice) => total + slice.data.length, 0);
      }
      return {
        samples,
        initialPixels,
        userAgent: navigator.userAgent,
      };
    }, { featureId: manifest.feature_id, layout, resolutionUm: manifest.resolution_um });
    userAgent = metrics.userAgent;
    const initialPaths = new Set(layout.files.filter((file) => {
      const match = /\/(\d+)\.f16\.gz$/.exec(file.path);
      return match && layout.centers.some((center) => Math.floor(center / layout.depth) === Number(match[1]));
    }).map((file) => file.path));
    const initialRequests = requests.filter((request) => initialPaths.has(request.path));
    layouts.push({
      depth: layout.depth,
      trials,
      initial: {
        requests_per_trial: initialRequests.length / trials,
        gzip_bytes_per_trial: initialRequests.reduce((sum, request) => sum + request.bytes, 0) / trials,
        timing: timing(metrics.samples.map((sample) => sample.initialMs)),
      },
      warm_same_pack: { additional_requests_per_trial: 0, timing: timing(metrics.samples.map((sample) => sample.warmMs)) },
      boundary: {
        requests_per_trial: (requests.length - initialRequests.length) / trials,
        gzip_bytes_per_trial: requests.filter((request) => !initialPaths.has(request.path)).reduce((sum, request) => sum + request.bytes, 0) / trials,
        timing: timing(metrics.samples.map((sample) => sample.boundaryMs)),
      },
      paint_six_planes: timing(metrics.samples.map((sample) => sample.paintSixPlanesMs)),
      initial_pixels: metrics.initialPixels,
    });
    expect(initialRequests).toHaveLength(3 * trials);
    expect(requests).toHaveLength(6 * trials);
  }

  const report = {
    benchmark: 'real-ephys-volume-browser-v1',
    measured_at: new Date().toISOString(),
    source: { ...manifest.source, feature_id: manifest.feature_id, feature_index: manifest.feature_index },
    axis_semantics: manifest.axis_semantics,
    environment: {
      browser: browserName,
      user_agent: userAgent,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
      cpus: os.cpus().length,
      memory_bytes: (await stat(artifactRoot!)).isDirectory() ? os.totalmem() : null,
    },
    layouts,
  };
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
});
