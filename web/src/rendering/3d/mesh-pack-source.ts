import { ResourceFetcher, type ResourceIntegrity } from '../../data/cache.js';
import type { MeshDecoderV1, MeshLodV1, MeshPackV1 } from '../../data/schema-v1.js';
import { validateSchemaV1Document } from '../../data/validation/schema-v1.js';
import { AbortableRequestCache } from '../volume.js';
import type { MeshChunk } from './mesh-pack-codec.js';
import { MeshPackRuntime, type MeshDecodeResult } from './mesh-pack-runtime.js';

export interface MeshManifestDescriptor extends ResourceIntegrity {
  readonly url: string;
}

export interface MeshDecodeRuntime {
  decode(compressed: ArrayBuffer, resource: MeshLodV1['resource'], decoder: MeshDecoderV1, maxDecodedBytes: number, signal?: AbortSignal): Promise<MeshDecodeResult>;
  dispose(): void;
}

export interface MeshPackSourceOptions {
  readonly manifest: MeshManifestDescriptor;
  readonly fetcher: ResourceFetcher;
  readonly runtime?: MeshDecodeRuntime;
  readonly maxDecodedBytes?: number;
}

export interface LoadedMeshLod {
  readonly id: string;
  readonly chunks: readonly MeshChunk[];
  readonly byteLength: number;
}

// D042's selected compiled-full pack decodes to 24,840,006 bytes. Keep the
// measured 25 MB acceptance ceiling explicit instead of sizing it to fixtures.
const DEFAULT_MAX_DECODED_BYTES = 25_000_000;

export function meshDecodedCacheKey(lod: MeshLodV1): string {
  return `${lod.resource.sha256}:${JSON.stringify({
    codec: lod.resource.codec,
    container: lod.decoder.container,
    container_version: lod.decoder.container_version,
    encoding: lod.decoder.encoding,
    position_bits: lod.decoder.position_bits,
    normal_bits: lod.decoder.normal_bits,
  })}`;
}

export class DecodedMeshLru {
  private readonly entries = new Map<string, LoadedMeshLod>();
  private bytes = 0;

  constructor(readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Mesh decoded cache budget must be a positive integer');
  }

  get byteLength(): number { return this.bytes; }
  get size(): number { return this.entries.size; }

  get(key: string): LoadedMeshLod | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: LoadedMeshLod): void {
    if (value.byteLength > this.maxBytes) throw new Error(`Mesh LOD ${value.id} exceeds the decoded cache budget`);
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.bytes -= previous.byteLength;
    }
    while (this.entries.size && this.bytes + value.byteLength > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string;
      this.bytes -= this.entries.get(oldest)!.byteLength;
      this.entries.delete(oldest);
    }
    this.entries.set(key, value);
    this.bytes += value.byteLength;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

export class MeshPackSource {
  private readonly manifestDescriptor: MeshManifestDescriptor;
  private readonly fetcher: ResourceFetcher;
  private readonly runtime: MeshDecodeRuntime;
  private readonly maxDecodedBytes: number;
  private readonly manifestRequests = new AbortableRequestCache<MeshPackV1>();
  private readonly lodRequests = new AbortableRequestCache<LoadedMeshLod>();
  private readonly decoded: DecodedMeshLru;
  private manifestValue: MeshPackV1 | null = null;
  private disposed = false;

  constructor(options: MeshPackSourceOptions) {
    this.manifestDescriptor = options.manifest;
    this.fetcher = options.fetcher;
    this.runtime = options.runtime ?? new MeshPackRuntime();
    this.maxDecodedBytes = options.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
    this.decoded = new DecodedMeshLru(this.maxDecodedBytes);
  }

  async loadManifest(signal?: AbortSignal): Promise<MeshPackV1> {
    this.assertActive();
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (this.manifestValue) return this.manifestValue;
    const key = `${this.manifestDescriptor.url}\u0000${this.manifestDescriptor.sha256}`;
    const manifest = await this.manifestRequests.load(key, async (sharedSignal) => {
      const response = await this.fetcher.fetch(this.manifestDescriptor.url, {
        immutable: true,
        integrity: this.manifestDescriptor,
        signal: sharedSignal,
      });
      const value = await response.json() as MeshPackV1;
      validateSchemaV1Document(value, 'mesh-pack.schema.json');
      return value;
    }, signal);
    this.assertActive();
    this.manifestValue = manifest;
    return manifest;
  }

  async loadDefault(signal?: AbortSignal): Promise<LoadedMeshLod> {
    const manifest = await this.loadManifest(signal);
    return this.loadSelected(manifest.default_lod_id, manifest, signal);
  }

  async loadUpgrade(signal?: AbortSignal): Promise<LoadedMeshLod | null> {
    const manifest = await this.loadManifest(signal);
    if (manifest.upgrade_lod_id === null) return null;
    return this.loadSelected(manifest.upgrade_lod_id, manifest, signal);
  }

  async prefetchDefault(signal?: AbortSignal): Promise<void> {
    await this.loadDefault(signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.manifestRequests.clear();
    this.lodRequests.clear();
    this.decoded.clear();
    this.runtime.dispose();
  }

  private async loadSelected(id: string, manifest: MeshPackV1, signal?: AbortSignal): Promise<LoadedMeshLod> {
    this.assertActive();
    if (id !== manifest.default_lod_id && id !== manifest.upgrade_lod_id) throw new Error(`Mesh LOD ${id} is not manifest-selected`);
    const lod = manifest.lods.find((candidate) => candidate.id === id);
    if (!lod) throw new Error(`Mesh LOD ${id} is unavailable`);
    const key = meshDecodedCacheKey(lod);
    const cached = this.decoded.get(key);
    if (cached) return cached;
    const value = await this.lodRequests.load(key, async (sharedSignal) => {
      const response = await this.fetcher.fetch(new URL(lod.resource.path, this.manifestDescriptor.url).toString(), {
        immutable: true,
        integrity: lod.resource,
        signal: sharedSignal,
      });
      const compressed = await response.arrayBuffer();
      const decoded = await this.runtime.decode(compressed, lod.resource, lod.decoder, this.maxDecodedBytes, sharedSignal);
      this.validateDecoded(lod, manifest, decoded);
      return { id: lod.id, chunks: decoded.chunks, byteLength: decoded.byteLength };
    }, signal);
    this.assertActive();
    this.decoded.set(key, value);
    return value;
  }

  private validateDecoded(lod: MeshLodV1, manifest: MeshPackV1, decoded: MeshDecodeResult): void {
    const ranges = decoded.chunks.flatMap((chunk) => chunk.ranges.map((range) => ({ chunk, range })));
    if (ranges.length !== manifest.regions.length) throw new Error(`Mesh LOD ${lod.id} region inventory differs from manifest`);
    for (const { chunk, range } of ranges) {
      const region = manifest.regions[range.featureId];
      if (!region || region.feature_id !== range.featureId || region.hemisphere !== chunk.hemisphere
        || region.signed_allen_id !== range.signedAllenId
        || region.signed_explode_group_id !== range.signedExplodeGroupId) {
        throw new Error(`Mesh LOD ${lod.id} signed feature identity differs from manifest`);
      }
    }
    const triangles = decoded.chunks.reduce((total, chunk) => total + chunk.indices.length / 3, 0);
    if (triangles !== lod.triangle_count) throw new Error(`Mesh LOD ${lod.id} triangle count differs from manifest`);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Mesh pack source was disposed');
  }
}
