import {
  planeToWorld,
  SLICE_WORLD_AXIS,
  worldToPlane,
  type SliceAxis,
  type SliceGuide,
  type SliceIndices,
  type WorldCoordinateUm,
} from '../core/spatial.js';
import type { AnatomySlice, AnatomySliceSource } from './types.js';
import { AnatomyPackStore } from './anatomy/pack-store.js';
import {
  ANATOMY_AXES,
  parseAnatomyPackManifest,
  type AnatomyPackManifest,
} from './anatomy/manifest.js';
import type {
  AnatomyPackPerformanceEvent,
  AnatomyPackPerformancePhase,
  GeneratedAnatomySliceSourceOptions,
} from './anatomy/source-types.js';

export { parseAnatomyPackManifest } from './anatomy/manifest.js';
export type {
  AnatomyPackManifest,
  AnatomyProjection,
  AnatomySynchronizationSentinel,
} from './anatomy/manifest.js';
export type {
  AnatomyPackPerformanceEvent,
  AnatomyPackPerformancePhase,
  GeneratedAnatomySliceSourceOptions,
} from './anatomy/source-types.js';

/**
 * Application-facing anatomy source. Manifest semantics live in anatomy/manifest
 * and transport/cache/decode mechanics live in AnatomyPackStore.
 */
export class GeneratedAnatomySliceSource implements AnatomySliceSource {
  private readonly fetchImpl: typeof fetch;
  private readonly cacheMode: RequestCache = 'force-cache';
  private readonly packDepth: 8 | 16 | 32 | undefined;
  private readonly manifestUrl: string;
  private readonly scheduleIdle: (callback: () => void) => void;
  private readonly store: AnatomyPackStore;
  private manifestPromise: Promise<AnatomyPackManifest> | null = null;
  private readonly queuedPrefetches = new Map<SliceAxis, { index: number; direction: -1 | 1 }>();
  private prefetchScheduled = false;

  constructor(options: GeneratedAnatomySliceSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.packDepth = options.packDepth;
    const maxCachedBytes = options.maxCachedBytes ?? 32 * 1024 * 1024;
    if (!Number.isInteger(maxCachedBytes) || maxCachedBytes <= 0) {
      throw new RangeError('maxCachedBytes must be a positive integer');
    }
    this.scheduleIdle = options.scheduleIdle ?? ((callback) => {
      if (typeof globalThis.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(() => callback(), { timeout: 1_000 });
      } else {
        globalThis.setTimeout(callback, 0);
      }
    });
    const baseUrl = typeof globalThis.location?.href === 'string' ? globalThis.location.href : 'http://localhost/';
    this.manifestUrl = new URL(options.manifestUrl, baseUrl).toString();
    this.store = new AnatomyPackStore({
      fetchImpl: this.fetchImpl,
      manifestUrl: this.manifestUrl,
      maxCachedBytes,
      ...(options.onPerformance ? { onPerformance: options.onPerformance } : {}),
    });
  }

  loadManifest(): Promise<AnatomyPackManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.fetchManifest();
      void this.manifestPromise.catch(() => { this.manifestPromise = null; });
    }
    return this.manifestPromise;
  }

  async getDisplaySliceIndices(): Promise<Readonly<Record<SliceAxis, readonly number[]>> | null> {
    const projections = (await this.loadManifest()).projections;
    if (!projections.coronal.displaySliceIndices
      || !projections.sagittal.displaySliceIndices
      || !projections.horizontal.displaySliceIndices) return null;
    return {
      coronal: projections.coronal.displaySliceIndices,
      sagittal: projections.sagittal.displaySliceIndices,
      horizontal: projections.horizontal.displaySliceIndices,
    };
  }

  async loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<AnatomySlice> {
    const manifest = await this.loadManifest();
    const projection = manifest.projections[axis];
    if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) {
      throw new RangeError(`${axis} anatomy index ${index} is outside [0, ${projection.sliceCount - 1}]`);
    }
    if (manifest.format === 'anatomy-pack-v3') {
      const fragment = await this.store.loadIndexedSlice(manifest, axis, index, signal);
      return {
        packFormat: 'anatomy-pack-v3',
        axis,
        sliceIndex: fragment.sliceIndex,
        worldCoordinateUm: fragment.worldCoordinateUm,
        paths: [],
        svgFragment: fragment.svg,
        viewBox: projection.viewBox,
      };
    }
    const packSet = this.packDepth == null
      ? projection.packSets['16'] ?? projection.packSets['32']
      : projection.packSets[String(this.packDepth) as '16' | '32'];
    if (!packSet || packSet.packDepth === 8) throw new Error(`${axis} anatomy has no depth-${this.packDepth} pack set`);
    const artifact = packSet.packs.find((candidate) => (
      index >= candidate.firstSliceIndex && index < candidate.firstSliceIndex + candidate.sliceCount
    ));
    if (!artifact) throw new Error(`${axis} anatomy index ${index} is not covered by a pack`);
    const pack = await this.store.loadJsonPack(manifest, axis, packSet.packDepth as 16 | 32, artifact, signal);
    const slice = pack.slices[index - artifact.firstSliceIndex];
    if (!slice || slice.sliceIndex !== index) throw new Error(`${artifact.path} does not contain ${axis} slice ${index}`);
    return { packFormat: manifest.format, axis, ...slice, viewBox: projection.viewBox };
  }

  async worldFromSliceIndices(indices: SliceIndices): Promise<WorldCoordinateUm> {
    const manifest = await this.loadManifest();
    const world: WorldCoordinateUm = { ml: 0, ap: 0, dv: 0 };
    for (const axis of ANATOMY_AXES) {
      const projection = manifest.projections[axis];
      const index = indices[axis];
      if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) {
        throw new RangeError(`${axis} anatomy index ${index} is outside [0, ${projection.sliceCount - 1}]`);
      }
      const coordinate = planeToWorld(projection.planeIndexToWorldUm, { slice: index, u: 0, v: 0 });
      world[projection.fixedWorldAxis] = coordinate[projection.fixedWorldAxis];
    }
    return world;
  }

  async guidesForWorld(axis: SliceAxis, world: WorldCoordinateUm): Promise<readonly SliceGuide[]> {
    const projection = (await this.loadManifest()).projections[axis];
    const plane = worldToPlane(projection.worldToPlaneIndex, world);
    return projection.planeAxes.map((worldAxis, index) => ({
      sourceAxis: ANATOMY_AXES.find((candidate) => SLICE_WORLD_AXIS[candidate] === worldAxis)!,
      targetAxis: axis,
      dimension: index === 0 ? 'x' : 'y',
      position: index === 0 ? plane.u : plane.v,
    }));
  }

  prefetchNextPack(axis: SliceAxis, index: number, direction: -1 | 1): void {
    this.queuedPrefetches.set(axis, { index, direction });
    if (this.prefetchScheduled) return;
    this.prefetchScheduled = true;
    this.scheduleIdle(() => {
      this.prefetchScheduled = false;
      const queued = [...this.queuedPrefetches];
      this.queuedPrefetches.clear();
      void this.prefetchQueuedNextPacks(queued).catch(() => {});
    });
  }

  dispose(): void {
    this.queuedPrefetches.clear();
    this.store.dispose();
  }

  private async fetchManifest(): Promise<AnatomyPackManifest> {
    const response = await this.fetchImpl(this.manifestUrl, { cache: this.cacheMode });
    if (!response.ok) throw new Error(`Anatomy manifest request failed (${response.status})`);
    return parseAnatomyPackManifest(await response.json());
  }

  private async prefetchQueuedNextPacks(
    entries: readonly (readonly [SliceAxis, { index: number; direction: -1 | 1 }])[],
  ): Promise<void> {
    const manifest = await this.loadManifest();
    const pending: Promise<unknown>[] = [];
    for (const [axis, request] of entries) {
      const task = this.store.prefetchNeighbor(manifest, axis, request.index, request.direction, this.packDepth);
      if (task) pending.push(task);
    }
    await Promise.allSettled(pending);
  }
}

// Re-exported names are intentionally referenced here so declaration emit keeps
// the public module surface stable for existing consumers.
export type _AnatomySourcePublicCompatibility =
  | AnatomyPackPerformanceEvent
  | AnatomyPackPerformancePhase;
