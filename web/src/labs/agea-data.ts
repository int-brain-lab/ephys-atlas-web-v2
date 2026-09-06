import { ResourceFetcher } from '../data/cache.js';
import { decodeBinaryArray, decodeResourceBytes } from '../data/validate.js';
import type { EncodedResourceDescriptor } from '../data/contracts.js';
import type { Triple } from './agea-model.js';

export interface Resource { path: string; bytes: number; sha256: string; decoded_bytes: number; codec: 'gzip' }
export interface Experiment { id: string; gene: string; experiment_id: string; volume: Resource; counts: Record<string, number> }
export interface LabManifest {
  format: 'agea-coverage-lab-only'; scientific_release: false; source_variant: string;
  source: Record<string, { bytes: number; sha256: string }>;
  shape: Triple; axis_order: string[]; index_to_world_um: number[]; geometry_status: string;
  labels: Resource; measured_counts: Resource;
  regions: Record<string, { name: string; acronym: string }>; features: Experiment[];
}
const fetcher = new ResourceFetcher();
function descriptor(r: Resource): EncodedResourceDescriptor {
  if (!/^[-a-zA-Z0-9_./]+$/.test(r.path) || r.path.split('/').includes('..') || r.path.startsWith('/')) throw new Error('Unsafe resource path');
  if (!Number.isSafeInteger(r.bytes) || r.bytes <= 0 || !/^[0-9a-f]{64}$/.test(r.sha256)
    || !Number.isSafeInteger(r.decoded_bytes) || r.decoded_bytes <= 0 || r.decoded_bytes > 32 * 1024 * 1024) throw new Error('Invalid lab resource descriptor');
  return { path: r.path, bytes: r.bytes, sha256: r.sha256, mediaType: 'application/octet-stream',
    codec: { name: 'gzip', decodedBytes: r.decoded_bytes } };
}
async function loadBytes(r: Resource, signal?: AbortSignal): Promise<ArrayBuffer> {
  const d = descriptor(r);
  const response = await fetcher.fetch(`/__agea_lab__/${d.path}`,
    { integrity: { bytes: d.bytes, sha256: d.sha256 }, ...(signal ? { signal } : {}) });
  return decodeResourceBytes(await response.arrayBuffer(), d);
}
export async function loadManifest(): Promise<LabManifest> {
  const response = await fetch('/__agea_lab__/coverage-lab-index.json');
  if (!response.ok) throw new Error(await response.text());
  const resource = await response.json() as Resource;
  const manifest = JSON.parse(new TextDecoder().decode(await loadBytes(resource))) as LabManifest;
  if (manifest.format !== 'agea-coverage-lab-only' || manifest.scientific_release !== false
    || manifest.shape.length !== 3 || manifest.shape.some(n => !Number.isInteger(n) || n <= 0)
    || manifest.shape.reduce((a, b) => a * b, 1) > 1_000_000
    || manifest.axis_order.join(',') !== 'ML,DV,AP' || manifest.index_to_world_um.length !== 16
    || manifest.index_to_world_um.some(v => !Number.isFinite(v))
    || !manifest.features.length || new Set(manifest.features.map(f => f.id)).size !== manifest.features.length) throw new Error('Invalid exploratory lab metadata');
  for (const r of [manifest.labels, manifest.measured_counts, ...manifest.features.map(f => f.volume)]) descriptor(r);
  return manifest;
}
export async function loadArray(r: Resource, dtype: 'float16' | 'int32' | 'uint16', shape: Triple, signal?: AbortSignal): Promise<number[]> {
  return decodeBinaryArray(await loadBytes(r, signal), { ...descriptor(r), format: 'raw-binary-array-v1', dtype,
    shape, order: 'C', endianness: 'little' });
}
