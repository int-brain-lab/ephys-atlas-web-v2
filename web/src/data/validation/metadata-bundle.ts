import type { DatasetManifestDocument, EncodedResourceDescriptor, FeatureDescriptor } from '../contracts.js';
import { parseEncodedResource } from './binary.js';
import { array, object, relativePath, resolveRelativePath } from './primitives.js';

export const MAX_METADATA_BUNDLE_BYTES = 64 * 1024 * 1024;
export function parseMetadataBundleResource(value: unknown): EncodedResourceDescriptor {
  const resource = parseEncodedResource(value, 'metadata_bundle');
  if (resource.path !== 'metadata-bundle.json.gz' || resource.codec.name !== 'gzip' || resource.mediaType !== 'application/json'
    || resource.codec.decodedBytes > MAX_METADATA_BUNDLE_BYTES || resource.bytes > MAX_METADATA_BUNDLE_BYTES) {
    throw new Error('metadata_bundle must be bounded gzip JSON');
  }
  return resource;
}

export function parseMetadataBundle(value: unknown): Map<string, string> {
  const root = object(value, 'metadata bundle');
  if (Object.keys(root).sort().join(',') !== 'format,resources,schema_version'
    || root.schema_version !== '1.0' || root.format !== 'ephys-atlas-metadata-bundle-v1') throw new Error('Invalid metadata bundle');
  const rows = array(root.resources, 'metadata bundle resources');
  if (!rows.length || rows.length > 20_000) throw new Error('Invalid metadata bundle entry count');
  const entries = new Map<string, string>();
  let size = 0;
  for (const row of rows) {
    const entry = object(row, 'metadata bundle entry');
    const path = relativePath(entry.path, 'metadata bundle path');
    if (Object.keys(entry).sort().join(',') !== 'path,text' || typeof entry.text !== 'string'
      || path === 'manifest.json' || entries.has(path)) throw new Error('Invalid or duplicate metadata bundle entry');
    size += new TextEncoder().encode(entry.text).byteLength;
    if (size > MAX_METADATA_BUNDLE_BYTES) throw new Error('Metadata bundle exceeds decoded limit');
    JSON.parse(entry.text);
    entries.set(path, entry.text);
  }
  return entries;
}

/** Exact individual JSON bytes remain authoritative; a bundle only removes requests. */
export async function readBundledJson(text: string, descriptor: EncodedResourceDescriptor): Promise<unknown> {
  if (descriptor.codec.name !== 'none' || descriptor.mediaType !== 'application/json') throw new Error('Bundle entry is not uncompressed JSON');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length !== descriptor.bytes) throw new Error('Bundled resource byte length mismatch');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== descriptor.sha256) throw new Error('Bundled resource SHA-256 mismatch');
  return JSON.parse(text) as unknown;
}

export function metadataJsonResources(document: DatasetManifestDocument, features: readonly FeatureDescriptor[]): Map<string, EncodedResourceDescriptor> {
  const resources = new Map<string, EncodedResourceDescriptor>();
  const add = (base: string, resource: EncodedResourceDescriptor | undefined) => {
    if (!resource || resource.mediaType !== 'application/json' || resource.codec.name !== 'none') return;
    const path = resolveRelativePath(base, resource.path, 'metadata JSON');
    const previous = resources.get(path);
    if (previous && (previous.bytes !== resource.bytes || previous.sha256 !== resource.sha256)) throw new Error('Conflicting metadata JSON resource');
    resources.set(path, resource);
  };
  document.featureRefs.forEach(ref => add('manifest.json', ref.resource));
  document.parcellations.forEach(parcel => add('manifest.json', parcel.metadataResource));
  document.artifacts.forEach(artifact => add('manifest.json', artifact.resource));
  for (const feature of features) {
    feature.artifacts?.forEach(artifact => add(feature.path, artifact.resource));
    add(feature.path, feature.representations.volume?.resourceIndexResource);
    add(feature.path, feature.representations.volume?.summaryResource);
    for (const parcel of Object.values(feature.representations.regional?.parcellations ?? {})) add(feature.path, parcel?.statisticsResource);
  }
  return resources;
}

export async function validateMetadataBundle(entries: ReadonlyMap<string, string>, resources: ReadonlyMap<string, EncodedResourceDescriptor>): Promise<void> {
  // Bounded concurrency avoids thousands of simultaneous WebCrypto allocations.
  const rows = [...entries];
  for (let start = 0; start < rows.length; start += 32) await Promise.all(rows.slice(start, start + 32).map(async ([path, text]) => {
    const resource = resources.get(path);
    if (!resource) throw new Error(`Undeclared metadata bundle JSON: ${path}`);
    await readBundledJson(text, resource);
  }));
}
