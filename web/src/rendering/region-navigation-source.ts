import { applyAffine, type Matrix4, type SliceIndices } from '../core/spatial.js';
import { ResourceFetcher } from '../data/cache.js';
import type { ProjectionPackV1, RegionNavigationV1 } from '../data/schema-v1.js';
import { validateSchemaV1Document } from '../data/validation/schema-v1.js';
import type { ParcellationId } from '../domain/types.js';

export interface RegionNavigationAssets {
  readonly manifest: unknown;
  readonly resources: Readonly<Record<ParcellationId, string>>;
}

export function decodeRegionAnchors(
  bytes: ArrayBuffer, manifest: RegionNavigationV1, mapping: ParcellationId,
): ReadonlyMap<number, SliceIndices | null> {
  const descriptor = manifest.mappings[mapping];
  if (bytes.byteLength !== descriptor.resource.bytes) throw new Error('Region navigation row byte length differs');
  const view = new DataView(bytes);
  const result = new Map<number, SliceIndices | null>();
  let previous = -Infinity;
  for (let offset = 0; offset < bytes.byteLength; offset += 16) {
    const id = view.getInt32(offset, true);
    const indices = [view.getInt32(offset + 4, true), view.getInt32(offset + 8, true), view.getInt32(offset + 12, true)] as const;
    if (id === 0 || id <= previous) throw new Error('Region navigation IDs must be nonzero, unique and sorted');
    previous = id;
    if (indices.every(index => index === -1)) {
      result.set(id, null);
      continue;
    }
    if (indices.some((index, axis) => index < 0 || index >= manifest.grid.shape[axis]!)) {
      throw new Error('Region navigation anchor is outside its declared grid');
    }
    const [ml] = applyAffine(manifest.grid.index_to_world_um as Matrix4, indices);
    if ((ml < 0) !== (id < 0)) throw new Error('Region navigation anchor crosses its signed hemisphere');
    result.set(id, { coronal: indices[0], sagittal: indices[1], horizontal: indices[2] });
  }
  return result;
}

/** Verified, lazy, per-mapping companion to one exact registered projection pack. */
export class RegionNavigationSource {
  private readonly manifest: RegionNavigationV1;
  private readonly fetcher: ResourceFetcher;
  private readonly loaded = new Map<ParcellationId, Promise<ReadonlyMap<number, SliceIndices | null>>>();

  constructor(private readonly assets: RegionNavigationAssets, fetchImpl?: typeof fetch) {
    validateSchemaV1Document(assets.manifest, 'region-navigation.schema.json');
    this.manifest = assets.manifest as RegionNavigationV1;
    this.fetcher = new ResourceFetcher(fetchImpl);
  }

  async locate(
    regionId: string, mapping: ParcellationId, pack: ProjectionPackV1, manifestSha256: string, signal: AbortSignal,
  ): Promise<SliceIndices | null> {
    signal.throwIfAborted();
    const id = Number(regionId);
    if (!Number.isSafeInteger(id) || id === 0) return null;
    const nav = this.manifest;
    if (nav.projection_pack.pack_id !== pack.pack_id
      || nav.projection_pack.manifest_sha256 !== manifestSha256
      || nav.reference_space_id !== pack.reference_space_id) {
      throw new Error('Region navigation is unavailable for this projection pack');
    }
    const coronal = pack.projections.find(p => p.id === 'coronal');
    if (!coronal || coronal.kind !== 'registered-slice-stack'
      || JSON.stringify(nav.grid.shape) !== JSON.stringify([coronal.slice_count, ...coronal.slice_shape])
      || JSON.stringify(nav.grid.index_to_world_um) !== JSON.stringify(coronal.plane_index_to_world_um)
      || pack.projections.some(p => p.kind === 'registered-slice-stack'
        && (p.reference_space_id !== nav.reference_space_id || p.grid_id !== nav.grid.grid_id))) {
      throw new Error('Region navigation grid is incompatible with registered anatomy');
    }
    let pending = this.loaded.get(mapping);
    if (!pending) {
      pending = this.load(mapping);
      this.loaded.set(mapping, pending);
      void pending.catch(() => this.loaded.delete(mapping));
    }
    // Reads are shared; cancelling one selection must not poison another.
    const anchors = await pending;
    signal.throwIfAborted();
    return anchors.get(id) ?? null;
  }

  private async load(mapping: ParcellationId): Promise<ReadonlyMap<number, SliceIndices | null>> {
    const response = await this.fetcher.fetch(this.assets.resources[mapping], {
      immutable: true, integrity: this.manifest.mappings[mapping].resource,
    });
    return decodeRegionAnchors(await response.arrayBuffer(), this.manifest, mapping);
  }
}
