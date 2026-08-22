import { ResourceFetcher } from '../data/cache.js';
import type {
  EncodedResourceV1,
  OrthogonalProjectionId,
  ProjectionPackV1,
  RegisteredProjectionV1,
  RegisteredSvgResourceIndexV1,
} from '../data/schema-v1.js';
import { validateSchemaV1Document } from '../data/validation/schema-v1.js';
import {
  planeToWorld,
  PROJECTION_PLANE_AXES,
  SLICE_WORLD_AXIS,
  worldToPlane,
  type Matrix4,
  type SliceAxis,
  type SliceGuide,
  type ViewBox,
  type WorldCoordinateUm,
} from '../core/spatial.js';
import {
  createDisplaySliceInventories,
  nearestDisplaySlice,
  type DisplaySliceInventory,
} from './display-slice-inventory.js';
import { createIsvgPackRuntime, type IsvgPackRuntime } from './isvg-pack-runtime.js';

const ORTHOGONAL_PROJECTIONS = ['coronal', 'sagittal', 'horizontal'] as const;

export interface RegisteredProjectionSlice {
  readonly axis: SliceAxis;
  readonly sliceIndex: number;
  readonly worldCoordinateUm: number;
  readonly svgFragment: string;
  readonly viewBox: ViewBox;
}

export interface RegisteredProjectionRegistration {
  readonly axis: SliceAxis;
  readonly referenceSpaceId: string;
  readonly viewBox: ViewBox;
  readonly planeIndexToWorldUm: Matrix4;
  readonly worldToPlaneIndex: Matrix4;
}

export interface ProjectionPackSourceOptions {
  readonly manifestUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly maxDecodedBytes?: number;
}

export interface RegisteredProjectionSource {
  getDisplaySliceInventories(): Promise<Readonly<Record<SliceAxis, DisplaySliceInventory>>>;
  getRegistration(axis: SliceAxis): Promise<RegisteredProjectionRegistration>;
  loadSlice(axis: SliceAxis, nativeIndex: number, signal?: AbortSignal): Promise<RegisteredProjectionSlice>;
  guidesForWorld(axis: SliceAxis, world: WorldCoordinateUm): Promise<readonly SliceGuide[]>;
  prefetchNeighbor(axis: SliceAxis, nativeIndex: number, direction: -1 | 1): Promise<void>;
  dispose(): void;
}

interface IndexedPack {
  readonly pack_id: string;
  readonly slice_indices: readonly number[];
  readonly resource: EncodedResourceV1;
}

function matrix(value: readonly number[]): Matrix4 {
  if (value.length !== 16) throw new Error('Projection affine must contain 16 values');
  return value as Matrix4;
}

function viewBox(value: readonly [number, number, number, number]): ViewBox {
  return { x: value[0], y: value[1], width: value[2], height: value[3] };
}

async function gunzipJson(response: Response, resource: EncodedResourceV1): Promise<unknown> {
  if (resource.codec.name !== 'gzip') throw new Error(`${resource.path} must be gzip-compressed`);
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode gzip projection indexes');
  const decoded = await new Response(
    response.body!.pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();
  if (decoded.byteLength !== resource.codec.decoded_bytes) {
    throw new Error(`${resource.path} decoded length does not match its descriptor`);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
}

/** Schema-v1 registered geometry source with verified transport and worker-owned decoded LRU. */
export class ProjectionPackSource implements RegisteredProjectionSource {
  private readonly manifestUrl: string;
  private readonly fetcher: ResourceFetcher;
  private readonly runtime: IsvgPackRuntime;
  private manifestPromise: Promise<ProjectionPackV1> | null = null;
  private readonly indexPromises = new Map<SliceAxis, Promise<RegisteredSvgResourceIndexV1>>();
  private readonly loadedPacks = new Map<string, Promise<void>>();

  constructor(options: ProjectionPackSourceOptions) {
    const baseUrl = typeof globalThis.location?.href === 'string' ? globalThis.location.href : 'http://localhost/';
    this.manifestUrl = new URL(options.manifestUrl, baseUrl).toString();
    this.fetcher = new ResourceFetcher(options.fetchImpl);
    this.runtime = createIsvgPackRuntime({ maxDecodedBytes: options.maxDecodedBytes ?? 32 * 1024 * 1024 });
  }

  async loadManifest(): Promise<ProjectionPackV1> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.fetchManifest();
      void this.manifestPromise.catch(() => { this.manifestPromise = null; });
    }
    return this.manifestPromise;
  }

  async getDisplaySliceInventories(): Promise<Readonly<Record<SliceAxis, DisplaySliceInventory>>> {
    const manifest = await this.loadManifest();
    return createDisplaySliceInventories(Object.fromEntries(
      ORTHOGONAL_PROJECTIONS.map((axis) => [axis, this.projection(manifest, axis).display_slices]),
    ) as Record<SliceAxis, readonly number[]>);
  }

  async getRegistration(axis: SliceAxis): Promise<RegisteredProjectionRegistration> {
    const projection = this.projection(await this.loadManifest(), axis);
    if (!projection.world_to_plane_index) throw new Error(`${axis} projection has no inverse affine`);
    return {
      axis,
      referenceSpaceId: projection.reference_space_id,
      viewBox: viewBox(projection.view_box),
      planeIndexToWorldUm: matrix(projection.plane_index_to_world_um),
      worldToPlaneIndex: matrix(projection.world_to_plane_index),
    };
  }

  async loadSlice(axis: SliceAxis, nativeIndex: number, signal?: AbortSignal): Promise<RegisteredProjectionSlice> {
    const manifest = await this.loadManifest();
    const projection = this.projection(manifest, axis);
    if (!Number.isInteger(nativeIndex) || nativeIndex < 0 || nativeIndex >= projection.slice_count) {
      throw new RangeError(`${axis} projection index ${nativeIndex} is outside [0, ${projection.slice_count - 1}]`);
    }
    const resolved = nearestDisplaySlice(projection.display_slices, nativeIndex);
    const index = await this.loadIndex(axis, projection);
    const entry = index.resources.find((candidate) => candidate.slice_indices.includes(resolved.nativeIndex));
    if (!entry) throw new Error(`${axis} display slice ${resolved.nativeIndex} is absent from its resource index`);
    await this.ensurePack(axis, projection, entry, signal);
    let fragment = await this.runtime.get(entry.pack_id, resolved.nativeIndex);
    if (!fragment) {
      this.loadedPacks.delete(entry.pack_id);
      await this.ensurePack(axis, projection, entry, signal);
      fragment = await this.runtime.get(entry.pack_id, resolved.nativeIndex);
    }
    if (!fragment) throw new Error(`${entry.resource.path} did not retain slice ${resolved.nativeIndex}`);
    const world = planeToWorld(matrix(projection.plane_index_to_world_um), {
      slice: resolved.nativeIndex,
      u: 0,
      v: 0,
    });
    return {
      axis,
      sliceIndex: resolved.nativeIndex,
      worldCoordinateUm: world[projection.world_slice_axis],
      svgFragment: fragment.svg,
      viewBox: viewBox(projection.view_box),
    };
  }

  async guidesForWorld(axis: SliceAxis, world: WorldCoordinateUm): Promise<readonly SliceGuide[]> {
    const projection = this.projection(await this.loadManifest(), axis);
    if (!projection.world_to_plane_index) throw new Error(`${axis} projection has no inverse affine`);
    const plane = worldToPlane(matrix(projection.world_to_plane_index), world);
    return PROJECTION_PLANE_AXES[axis].map((worldAxis, index) => ({
      sourceAxis: ORTHOGONAL_PROJECTIONS.find(
        (candidate) => SLICE_WORLD_AXIS[candidate] === worldAxis,
      )!,
      targetAxis: axis,
      dimension: index === 0 ? 'x' : 'y',
      position: index === 0 ? plane.u : plane.v,
    }));
  }

  async prefetchNeighbor(axis: SliceAxis, nativeIndex: number, direction: -1 | 1): Promise<void> {
    const manifest = await this.loadManifest();
    const projection = this.projection(manifest, axis);
    const resolved = nearestDisplaySlice(projection.display_slices, nativeIndex);
    const nextSlice = projection.display_slices[resolved.ordinal + direction];
    if (nextSlice === undefined) return;
    const index = await this.loadIndex(axis, projection);
    const entry = index.resources.find((candidate) => candidate.slice_indices.includes(nextSlice));
    if (entry) await this.ensurePack(axis, projection, entry);
  }

  dispose(): void {
    this.runtime.dispose();
    this.indexPromises.clear();
    this.loadedPacks.clear();
  }

  private async fetchManifest(): Promise<ProjectionPackV1> {
    const response = await this.fetcher.fetch(this.manifestUrl);
    const document: unknown = await response.json();
    validateSchemaV1Document(document, 'projection-pack.schema.json');
    return document as ProjectionPackV1;
  }

  private projection(manifest: ProjectionPackV1, axis: SliceAxis): RegisteredProjectionV1 {
    const projection = manifest.projections.find((candidate) => candidate.id === axis);
    if (!projection || projection.kind !== 'registered-slice-stack') {
      throw new Error(`Projection pack has no registered ${axis} projection`);
    }
    return projection;
  }

  private loadIndex(
    axis: SliceAxis,
    projection: RegisteredProjectionV1,
  ): Promise<RegisteredSvgResourceIndexV1> {
    let pending = this.indexPromises.get(axis);
    if (!pending) {
      pending = this.fetchIndex(axis, projection);
      this.indexPromises.set(axis, pending);
      void pending.catch(() => this.indexPromises.delete(axis));
    }
    return pending;
  }

  private async fetchIndex(
    axis: SliceAxis,
    projection: RegisteredProjectionV1,
  ): Promise<RegisteredSvgResourceIndexV1> {
    const resource = projection.resource_index.resource;
    const response = await this.fetcher.fetch(new URL(resource.path, this.manifestUrl).toString(), {
      immutable: true,
      integrity: resource,
    });
    const document = await gunzipJson(response, resource);
    validateSchemaV1Document(document, 'registered-svg-resource-index.schema.json');
    const index = document as RegisteredSvgResourceIndexV1;
    if (index.projection_id !== axis) throw new Error(`${resource.path} belongs to ${index.projection_id}, not ${axis}`);
    const indexedSlices = index.resources.flatMap((entry) => entry.slice_indices);
    if (indexedSlices.length !== projection.display_slices.length
      || indexedSlices.some((slice, position) => slice !== projection.display_slices[position])) {
      throw new Error(`${resource.path} does not match the ${axis} display inventory`);
    }
    return index;
  }

  private ensurePack(
    axis: OrthogonalProjectionId,
    projection: RegisteredProjectionV1,
    entry: IndexedPack,
    signal?: AbortSignal,
  ): Promise<void> {
    let pending = this.loadedPacks.get(entry.pack_id);
    if (!pending) {
      pending = this.fetchPack(axis, projection, entry, signal);
      this.loadedPacks.set(entry.pack_id, pending);
      void pending.catch(() => this.loadedPacks.delete(entry.pack_id));
    }
    return pending;
  }

  private async fetchPack(
    axis: OrthogonalProjectionId,
    projection: RegisteredProjectionV1,
    entry: IndexedPack,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.fetcher.fetch(new URL(entry.resource.path, this.manifestUrl).toString(), {
      immutable: true,
      integrity: entry.resource,
      ...(signal ? { signal } : {}),
    });
    const compressed = await response.arrayBuffer();
    const entries = entry.slice_indices.map((sliceIndex) => ({
      sliceIndex,
      worldCoordinateUm: planeToWorld(matrix(projection.plane_index_to_world_um), {
        slice: sliceIndex,
        u: 0,
        v: 0,
      })[projection.world_slice_axis],
    }));
    const result = await this.runtime.loadPack({
      projection: axis,
      packId: entry.pack_id,
      uncompressedBytes: entry.resource.codec.decoded_bytes,
      entries,
    }, compressed);
    for (const evicted of result.evictedPackIds) this.loadedPacks.delete(evicted);
  }
}
