import { planeToWorld, type SliceAxis } from '../../core/spatial.js';
import { createAnatomyPackDecoder, type AnatomyPackDecoder } from '../generated-anatomy-pack-decoder.js';
import type {
  AnatomyPackDecodeContext,
  AnatomyPackDecodePhase,
  SlicePack,
} from '../generated-anatomy-pack-codec.js';
import { createIsvgPackRuntime, type IsvgPackRuntime } from '../isvg-pack-runtime.js';
import type { SvgPackFragment } from '../svg-pack.js';
import { nearestDisplaySlice } from './manifest-projection.js';
import type { AnatomyPackManifest, PackArtifact } from './types.js';
import type { AnatomyPackPerformanceEvent, AnatomyPackPerformancePhase } from './source-types.js';

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AnatomyPackStoreOptions {
  fetchImpl: typeof fetch;
  manifestUrl: string;
  maxCachedBytes: number;
  onPerformance?: (event: AnatomyPackPerformanceEvent) => void;
}

/**
 * Owns immutable anatomy pack transport, integrity verification, decoding and
 * byte-bounded caches. Coordinate/view orchestration stays in the slice source.
 */
export class AnatomyPackStore {
  private readonly cacheMode: RequestCache = 'force-cache';
  private readonly decoder: AnatomyPackDecoder = createAnatomyPackDecoder();
  private isvgRuntime: IsvgPackRuntime | null = null;
  private readonly packs = new Map<string, Promise<SlicePack>>();
  private readonly isvgPacks = new Map<string, Promise<void>>();
  private readonly packDecodedBytes = new Map<string, number>();
  private readonly settledPackKeys = new Set<string>();
  private readonly packLru: string[] = [];
  private cachedBytes = 0;

  constructor(private readonly options: AnatomyPackStoreOptions) {}

  dispose(): void {
    this.decoder.dispose();
    this.isvgRuntime?.dispose();
    this.isvgRuntime = null;
    this.packs.clear();
    this.isvgPacks.clear();
    this.packDecodedBytes.clear();
    this.settledPackKeys.clear();
    this.packLru.length = 0;
    this.cachedBytes = 0;
  }

  loadJsonPack(
    manifest: AnatomyPackManifest,
    axis: SliceAxis,
    packDepth: 16 | 32,
    artifact: PackArtifact,
    signal?: AbortSignal,
  ): Promise<SlicePack> {
    const key = `${axis}:${packDepth}:${artifact.path}`;
    let pending = this.packs.get(key);
    if (!pending) {
      pending = this.fetchJsonPack(manifest, axis, packDepth, artifact, signal);
      this.packs.set(key, pending);
      this.touchPack(key);
      void pending.then(
        () => {
          this.settledPackKeys.add(key);
          this.packDecodedBytes.set(key, artifact.uncompressedBytes);
          this.cachedBytes += artifact.uncompressedBytes;
          this.trimPackCache();
        },
        () => this.deletePack(key),
      );
    } else {
      this.touchPack(key);
    }
    return pending;
  }

  async loadIndexedSlice(
    manifest: AnatomyPackManifest,
    axis: SliceAxis,
    index: number,
    signal?: AbortSignal,
  ): Promise<SvgPackFragment> {
    this.ensureIndexedRuntime();
    const projection = manifest.projections[axis];
    const display = projection.displaySliceIndices;
    if (!display) throw new Error(`${axis} anatomy v3 has no display slice inventory`);
    const resolved = nearestDisplaySlice(display, index);
    const packSet = projection.packSets['8'];
    if (!packSet) throw new Error(`${axis} anatomy v3 has no depth-8 pack set`);
    const artifact = packSet.packs.find((candidate) => (
      resolved.ordinal >= candidate.firstDisplayIndex!
      && resolved.ordinal < candidate.firstDisplayIndex! + candidate.sliceCount
    ));
    if (!artifact?.packId) throw new Error(`${axis} anatomy display slice ${resolved.nativeIndex} is not covered by a pack`);
    const expectedSlices = display.slice(
      artifact.firstDisplayIndex!,
      artifact.firstDisplayIndex! + artifact.sliceCount,
    );
    await this.ensureIndexedPack(manifest, axis, artifact, signal, expectedSlices);
    const fragment = await this.isvgRuntime!.get(artifact.packId, resolved.nativeIndex);
    if (fragment) return fragment;
    this.isvgPacks.delete(artifact.packId);
    await this.ensureIndexedPack(manifest, axis, artifact, signal, expectedSlices);
    const retried = await this.isvgRuntime!.get(artifact.packId, resolved.nativeIndex);
    if (!retried) throw new Error(`${artifact.path} did not retain display slice ${resolved.nativeIndex}`);
    return retried;
  }

  prefetchNeighbor(
    manifest: AnatomyPackManifest,
    axis: SliceAxis,
    index: number,
    direction: -1 | 1,
    requestedDepth?: 8 | 16 | 32,
  ): Promise<unknown> | null {
    const projection = manifest.projections[axis];
    if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) return null;
    if (manifest.format === 'anatomy-pack-v3') {
      const display = projection.displaySliceIndices;
      const set = projection.packSets['8'];
      if (!display || !set) return null;
      const displayIndex = nearestDisplaySlice(display, index).ordinal + direction;
      const artifact = set.packs.find((candidate) => (
        displayIndex >= candidate.firstDisplayIndex!
        && displayIndex < candidate.firstDisplayIndex! + candidate.sliceCount
      ));
      if (!artifact) return null;
      return this.ensureIndexedPack(
        manifest,
        axis,
        artifact,
        undefined,
        display.slice(artifact.firstDisplayIndex!, artifact.firstDisplayIndex! + artifact.sliceCount),
      );
    }
    const packSet = requestedDepth == null
      ? projection.packSets['16'] ?? projection.packSets['32']
      : projection.packSets[String(requestedDepth) as '16' | '32'];
    if (!packSet || packSet.packDepth === 8) return null;
    const current = packSet.packs.find((artifact) => (
      index >= artifact.firstSliceIndex && index < artifact.firstSliceIndex + artifact.sliceCount
    ));
    const neighbor = current ? packSet.packs[current.packIndex + direction] : undefined;
    return neighbor
      ? this.loadJsonPack(manifest, axis, packSet.packDepth as 16 | 32, neighbor)
      : null;
  }

  private ensureIndexedRuntime(): void {
    this.isvgRuntime ??= createIsvgPackRuntime({ maxDecodedBytes: this.options.maxCachedBytes });
  }

  private ensureIndexedPack(
    manifest: AnatomyPackManifest,
    axis: SliceAxis,
    artifact: PackArtifact,
    signal: AbortSignal | undefined,
    expectedSlices: readonly number[],
  ): Promise<void> {
    this.ensureIndexedRuntime();
    const key = artifact.packId!;
    let pending = this.isvgPacks.get(key);
    if (!pending) {
      pending = this.fetchIndexedPack(manifest, axis, artifact, signal, expectedSlices);
      this.isvgPacks.set(key, pending);
      void pending.catch(() => this.isvgPacks.delete(key));
    }
    return pending;
  }

  private async fetchIndexedPack(
    manifest: AnatomyPackManifest,
    axis: SliceAxis,
    artifact: PackArtifact,
    signal: AbortSignal | undefined,
    expectedSlices: readonly number[],
  ): Promise<void> {
    const buffer = await this.fetchVerifiedBytes(axis, artifact, signal);
    const projection = manifest.projections[axis];
    const entries = expectedSlices.map((sliceIndex) => ({
      sliceIndex,
      worldCoordinateUm: planeToWorld(
        projection.planeIndexToWorldUm,
        { slice: sliceIndex, u: 0, v: 0 },
      )[projection.fixedWorldAxis],
    }));
    const started = this.performanceStart();
    const result = await this.isvgRuntime!.loadPack({
      projection: axis,
      packId: artifact.packId!,
      uncompressedBytes: artifact.uncompressedBytes,
      entries,
    }, buffer);
    this.reportPerformance('worker-roundtrip', axis, artifact, started, result.decodedBytes);
    for (const evicted of result.evictedPackIds) this.isvgPacks.delete(evicted);
  }

  private async fetchJsonPack(
    manifest: AnatomyPackManifest,
    axis: SliceAxis,
    packDepth: 16 | 32,
    artifact: PackArtifact,
    signal?: AbortSignal,
  ): Promise<SlicePack> {
    const buffer = await this.fetchVerifiedBytes(axis, artifact, signal);
    const projection = manifest.projections[axis];
    const context: AnatomyPackDecodeContext = {
      format: manifest.format as 'anatomy-pack-v1' | 'anatomy-pack-v2',
      packId: manifest.packId,
      axis,
      packDepth,
      fixedWorldAxis: projection.fixedWorldAxis,
      planeIndexToWorldUm: projection.planeIndexToWorldUm,
      artifact: {
        packIndex: artifact.packIndex,
        firstSliceIndex: artifact.firstSliceIndex,
        sliceCount: artifact.sliceCount,
        path: artifact.path,
        uncompressedBytes: artifact.uncompressedBytes,
      },
    };
    const started = this.performanceStart();
    const decoded = await this.decoder.decode(buffer, context);
    for (const timing of decoded.timings) {
      this.reportPerformanceDuration(timing.phase, axis, artifact, timing.durationMs, decoded.decodedBytes);
    }
    if (this.decoder.offThread) {
      this.reportPerformance('worker-roundtrip', axis, artifact, started, decoded.decodedBytes);
    }
    return decoded.pack;
  }

  private async fetchVerifiedBytes(
    axis: SliceAxis,
    artifact: PackArtifact,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    let started = this.performanceStart();
    const response = await this.options.fetchImpl(new URL(artifact.path, this.options.manifestUrl), {
      cache: this.cacheMode,
      ...(signal ? { signal } : {}),
    });
    this.reportPerformance('fetch', axis, artifact, started);
    if (!response.ok) throw new Error(`Anatomy pack request failed (${response.status}): ${artifact.path}`);
    started = this.performanceStart();
    const buffer = await response.arrayBuffer();
    this.reportPerformance('read-response', axis, artifact, started);
    if (buffer.byteLength !== artifact.bytes) {
      throw new Error(`${artifact.path} has ${buffer.byteLength} bytes; expected ${artifact.bytes}`);
    }
    started = this.performanceStart();
    const digest = await sha256Hex(buffer);
    this.reportPerformance('sha256', axis, artifact, started);
    if (digest !== artifact.sha256) throw new Error(`SHA-256 mismatch for anatomy pack ${artifact.path}`);
    return buffer;
  }

  private touchPack(key: string): void {
    const previousIndex = this.packLru.indexOf(key);
    if (previousIndex >= 0) this.packLru.splice(previousIndex, 1);
    this.packLru.push(key);
  }

  private trimPackCache(): void {
    while (this.cachedBytes > this.options.maxCachedBytes && this.settledPackKeys.size > 1) {
      const candidateIndex = this.packLru.findIndex((key) => this.settledPackKeys.has(key));
      if (candidateIndex < 0) return;
      const [candidate] = this.packLru.splice(candidateIndex, 1);
      if (candidate) this.deletePack(candidate, false);
    }
  }

  private deletePack(key: string, removeLru = true): void {
    this.cachedBytes -= this.packDecodedBytes.get(key) ?? 0;
    this.packs.delete(key);
    this.packDecodedBytes.delete(key);
    this.settledPackKeys.delete(key);
    if (removeLru) {
      const index = this.packLru.indexOf(key);
      if (index >= 0) this.packLru.splice(index, 1);
    }
  }

  private reportPerformance(
    phase: AnatomyPackPerformancePhase,
    axis: SliceAxis,
    artifact: PackArtifact,
    started: number,
    decodedBytes?: number,
  ): void {
    this.reportPerformanceDuration(phase, axis, artifact, performance.now() - started, decodedBytes);
  }

  private reportPerformanceDuration(
    phase: AnatomyPackPerformancePhase | AnatomyPackDecodePhase,
    axis: SliceAxis,
    artifact: PackArtifact,
    durationMs: number,
    decodedBytes?: number,
  ): void {
    const observer = this.options.onPerformance;
    if (!observer) return;
    try {
      observer({
        phase,
        axis,
        packIndex: artifact.packIndex,
        path: artifact.path,
        durationMs,
        compressedBytes: artifact.bytes,
        ...(decodedBytes == null ? {} : { decodedBytes }),
      });
    } catch {
      // Performance observers must not affect rendering.
    }
  }

  private performanceStart(): number {
    return this.options.onPerformance ? performance.now() : 0;
  }
}
