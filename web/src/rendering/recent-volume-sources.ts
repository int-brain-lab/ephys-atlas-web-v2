import type { VolumeFeaturePayload } from '../data/contracts.js';
import type { VolumeSliceSource } from './volume.js';

/** Retain small decoded volumes across feature switches within one shared budget. */
export class RecentVolumeSources {
  private readonly entries = new Map<string | VolumeFeaturePayload, { source: VolumeSliceSource; reservedBytes: number }>();
  private readonly identities = new WeakMap<VolumeFeaturePayload, string>();
  private reservedBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly create: (feature: VolumeFeaturePayload, reservedBytes: number) => VolumeSliceSource,
    private readonly maxEntries = 8,
  ) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('recent volume cache requires positive byte and entry limits');
    }
  }

  get(feature: VolumeFeaturePayload): VolumeSliceSource {
    let key: string | VolumeFeaturePayload = feature;
    if (feature.baseUrl) {
      // Include the entire decoding/grid/validity contract and all resource hashes.
      // Feature-relative paths or matching names alone never identify decoded data.
      key = this.identities.get(feature) ?? JSON.stringify([feature.baseUrl, feature.featureId, feature.descriptor]);
      this.identities.set(feature, key);
    }
    // Local/lab payloads without a transport identity must not reuse an old
    // loader closure after deleting/reimporting identical bytes under a new selector.
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.source;
    }
    const maskBytes = feature.descriptor.validity.kind === 'mask'
      ? feature.descriptor.validity.mask.resource.codec.decodedBytes : 0;
    const fullBytes = feature.descriptor.grid.shape.reduce((total, count) => total * count, 4) + maskBytes;
    const reservedBytes = Math.min(this.maxBytes, fullBytes);
    // Reserve capacity, not current occupancy: background adjacent-slice loads
    // cannot silently grow each retained source to the factory's whole budget.
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.reservedBytes + reservedBytes > this.maxBytes)) {
      const [oldKey, old] = this.entries.entries().next().value!;
      this.entries.delete(oldKey);
      this.reservedBytes -= old.reservedBytes;
      old.source.dispose?.();
    }
    const source = this.create(feature, reservedBytes);
    this.entries.set(key, { source, reservedBytes });
    this.reservedBytes += reservedBytes;
    return source;
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.source.dispose?.();
    this.entries.clear();
    this.reservedBytes = 0;
  }
}
