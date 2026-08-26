import type { ParcellationId } from '../../domain/types.js';
import type {
  BinaryArrayDescriptor,
  EncodedResourceDescriptor,
  FeatureDescriptor,
  DatasetManifestDocument,
} from '../contracts.js';
import { binaryBytes, decodeBinaryArray, parseBinaryArray, parseEncodedResource } from './binary.js';
import { parseFeatureDescriptor } from './feature.js';
import { parseDatasetManifestDocument } from './manifest.js';
import {
  array,
  object,
  resolveRelativePath,
  string,
} from './primitives.js';
import { parseStatisticsDocument } from './statistics.js';
import { parseVolumeResourceIndex, parseVolumeSummary } from './volume-v1.js';
import { parseArtifactDescriptors } from './artifact.js';

interface ArtifactExpectation {
  path: string;
  bytes: number;
  sha256: string;
  context: string;
}

interface ResourceExpectation {
  path: string;
  context: string;
  bytes?: number;
  sha256?: string;
  decodedBytes?: number;
  codec?: 'none' | 'gzip';
}

export interface ValidatedLocalDataset {
  document: DatasetManifestDocument;
  features: readonly FeatureDescriptor[];
}

function parseArtifacts(value: unknown, baseFile: string, context: string): ArtifactExpectation[] {
  return parseArtifactDescriptors(value, context).map((item, index) => {
    const resource = item.resource;
    const path = resolveRelativePath(
      baseFile,
      resource.path,
      `${context}[${index}].path`,
    );
    return { path, bytes: resource.bytes, sha256: resource.sha256, context: `${context}[${index}]` };
  });
}

async function readJsonResource(
  files: ReadonlyMap<string, Blob>,
  path: string,
  context: string,
): Promise<unknown> {
  const file = files.get(path);
  if (!file) throw new Error(`Local dataset is missing ${path} (${context})`);
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${path} is not valid JSON: ${error.message}`);
    throw error;
  }
}

async function parseJsonResource(
  files: ReadonlyMap<string, Blob>,
  path: string,
  context: string,
): Promise<Record<string, unknown>> {
  return object(await readJsonResource(files, path, context), context);
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function decodedByteLength(blob: Blob, codec: 'none' | 'gzip', path: string): Promise<number> {
  if (codec === 'none') return blob.size;
  if (!('DecompressionStream' in globalThis)) {
    throw new Error(`Cannot validate gzip resource ${path}: DecompressionStream is unavailable`);
  }
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    throw new Error(`Local resource ${path} is not valid gzip data`);
  }
}

async function decodedBuffer(blob: Blob, codec: 'none' | 'gzip', path: string): Promise<ArrayBuffer> {
  if (codec === 'none') return blob.arrayBuffer();
  if (!('DecompressionStream' in globalThis)) {
    throw new Error(`Cannot decode gzip resource ${path}: DecompressionStream is unavailable`);
  }
  try {
    return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } catch {
    throw new Error(`Local resource ${path} is not valid gzip data`);
  }
}

function addResource(resources: Map<string, ResourceExpectation>, expectation: ResourceExpectation): void {
  const existing = resources.get(expectation.path);
  if (!existing) {
    resources.set(expectation.path, expectation);
    return;
  }
  for (const key of ['bytes', 'sha256', 'decodedBytes', 'codec'] as const) {
    const previous = existing[key];
    const next = expectation[key];
    if (previous !== undefined && next !== undefined && previous !== next) {
      throw new Error(`Inconsistent declarations for ${expectation.path}: ${existing.context} and ${expectation.context}`);
    }
  }
  resources.set(expectation.path, {
    ...existing,
    ...expectation,
    context: `${existing.context}; ${expectation.context}`,
  });
}

function addBinaryResource(
  resources: Map<string, ResourceExpectation>,
  baseFile: string,
  descriptor: BinaryArrayDescriptor,
  context: string,
): string {
  const path = resolveRelativePath(baseFile, descriptor.path, context);
  const expectedBytes = binaryBytes(descriptor);
  if (descriptor.codec.decodedBytes !== expectedBytes) {
    throw new Error(`${context}.bytes is ${descriptor.bytes}; dtype and shape require ${expectedBytes}`);
  }
  addResource(resources, {
    path,
    context,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
    decodedBytes: expectedBytes,
    codec: descriptor.codec.name,
  });
  return path;
}

function addEncodedResource(
  resources: Map<string, ResourceExpectation>,
  baseFile: string,
  descriptor: EncodedResourceDescriptor,
  context: string,
): string {
  const path = resolveRelativePath(baseFile, descriptor.path, context);
  addResource(resources, {
    path,
    context,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
    decodedBytes: descriptor.codec.decodedBytes,
    codec: descriptor.codec.name,
  });
  return path;
}

async function validateResourceFiles(
  files: ReadonlyMap<string, Blob>,
  resources: ReadonlyMap<string, ResourceExpectation>,
): Promise<void> {
  for (const resource of resources.values()) {
    const file = files.get(resource.path);
    if (!file) throw new Error(`Local dataset is missing ${resource.path} (${resource.context})`);
    if (resource.bytes !== undefined && file.size !== resource.bytes) {
      throw new Error(`${resource.path} has ${file.size} bytes; expected ${resource.bytes}`);
    }
    if (resource.decodedBytes !== undefined) {
      const actual = await decodedByteLength(file, resource.codec ?? 'none', resource.path);
      if (actual !== resource.decodedBytes) {
        throw new Error(`${resource.path} decodes to ${actual} bytes; expected ${resource.decodedBytes}`);
      }
    }
    if (resource.sha256 && await sha256Hex(file) !== resource.sha256) {
      throw new Error(`SHA-256 mismatch for ${resource.path}`);
    }
  }
}

/** Validate the complete browser-supported schema-v1 graph before IndexedDB is mutated. */
export async function validateLocalDatasetFiles(
  files: ReadonlyMap<string, Blob>,
): Promise<ValidatedLocalDataset> {
  const manifestRaw = await parseJsonResource(files, 'manifest.json', 'manifest');
  const document = parseDatasetManifestDocument(manifestRaw);
  const resources = new Map<string, ResourceExpectation>();
  for (const featureRef of document.featureRefs) {
    addEncodedResource(resources, 'manifest.json', featureRef.resource, `feature ${featureRef.id}`);
  }
  for (const artifact of parseArtifacts(manifestRaw.artifacts, 'manifest.json', 'manifest.artifacts')) {
    addResource(resources, artifact);
  }

  const regionCounts = new Map<ParcellationId, number>();
  for (const parcel of document.parcellations) {
    if (!['int16', 'int32', 'uint16', 'uint32'].includes(parcel.regionIndex.dtype)) {
      throw new Error(`${parcel.id} region index must use an integer dtype`);
    }
    const indexPath = addBinaryResource(
      resources,
      'manifest.json',
      parcel.regionIndex,
      `manifest.parcellations.${parcel.id}.region_index`,
    );
    const count = parcel.regionIndex.shape.length === 1 ? parcel.regionIndex.shape[0] : undefined;
    if (count === undefined) throw new Error(`${parcel.id} region index must be one-dimensional`);
    regionCounts.set(parcel.id, count);
    if (!parcel.metadata) throw new Error(`${parcel.id} parcellation requires metadata for browser import`);
    if (!parcel.metadataResource) throw new Error(`${parcel.id} parcellation metadata has no integrity descriptor`);
    addEncodedResource(
      resources,
      'manifest.json',
      parcel.metadataResource,
      `manifest.parcellations.${parcel.id}.metadata`,
    );

    const metadata = array(
      await readJsonResource(files, parcel.metadata, `${parcel.id} region metadata`),
      `${parcel.id} region metadata`,
    );
    if (metadata.length !== count) throw new Error(`${parcel.id} metadata has ${metadata.length} rows; expected ${count}`);
    const regionIdsFile = files.get(indexPath);
    if (!regionIdsFile) throw new Error(`Local dataset is missing ${indexPath}`);
    const regionIds = decodeBinaryArray(
      await decodedBuffer(regionIdsFile, parcel.regionIndex.codec.name, indexPath),
      { ...parcel.regionIndex, path: indexPath },
    );
    const seenAtlasIds = new Set<number>();
    for (const [row, raw] of metadata.entries()) {
      const item = object(raw, `${parcel.id} metadata[${row}]`);
      if (!Number.isInteger(item.index) || !Number.isInteger(item.atlas_id)) {
        throw new Error(`${parcel.id} metadata[${row}] requires integer index and atlas_id`);
      }
      const index = item.index as number;
      const atlasId = item.atlas_id as number;
      if (index !== row || regionIds[row] !== atlasId) {
        throw new Error(`${parcel.id} metadata/index mismatch at row ${row}`);
      }
      if (seenAtlasIds.has(atlasId)) throw new Error(`${parcel.id} metadata contains duplicate atlas_id ${atlasId}`);
      seenAtlasIds.add(atlasId);
    }
  }

  const features: FeatureDescriptor[] = [];
  for (const featureRef of document.featureRefs) {
    const featureRaw = await parseJsonResource(files, featureRef.path, `feature ${featureRef.path}`);
    const feature = parseFeatureDescriptor(featureRaw, featureRef.path);
    if (feature.id !== featureRef.id) {
      throw new Error(`Feature id mismatch for ${featureRef.path}: expected ${featureRef.id}, got ${feature.id}`);
    }
    features.push(feature);
    for (const artifact of parseArtifacts(featureRaw.artifacts, featureRef.path, `${featureRef.path}.artifacts`)) {
      addResource(resources, artifact);
    }

    const regional = feature.representations.regional;
    if (regional) {
      for (const [parcellationId, descriptor] of Object.entries(regional.parcellations) as [
        ParcellationId,
        NonNullable<typeof regional.parcellations[ParcellationId]>,
      ][]) {
        const count = regionCounts.get(parcellationId);
        if (count === undefined) throw new Error(`${feature.id} references undeclared ${parcellationId} parcellation`);
        if (descriptor.values.shape.length !== 1 || descriptor.values.shape[0] !== count) {
          throw new Error(`${feature.id}/${parcellationId} values shape must be [${count}]`);
        }
        addBinaryResource(resources, feature.path, descriptor.values, `${feature.id}/${parcellationId} values`);
        const statisticsPath = resolveRelativePath(
          feature.path,
          descriptor.statistics,
          `${feature.id}/${parcellationId} statistics`,
        );
        addEncodedResource(
          resources,
          feature.path,
          descriptor.statisticsResource,
          `${feature.id}/${parcellationId} statistics`,
        );
        const statistics = parseStatisticsDocument(
          await parseJsonResource(files, statisticsPath, `${feature.id}/${parcellationId} statistics`),
        );
        if (statistics.values.shape.length !== 2
          || statistics.values.shape[0] !== count
          || statistics.values.shape[1] !== statistics.fields.length) {
          throw new Error(`${feature.id}/${parcellationId} statistics shape must be [${count}, ${statistics.fields.length}]`);
        }
        addBinaryResource(resources, statisticsPath, statistics.values, `${feature.id}/${parcellationId} regional summary`);
        if (statistics.histogram) {
          const variants = [
            { axisScale: 'linear', edges: statistics.histogram.edges, regionalCounts: statistics.histogram.regionalCounts },
            ...statistics.histogram.variants,
          ];
          for (const variant of variants) {
            const bins = variant.edges.length - 1;
            if (variant.regionalCounts.shape.length !== 2
              || variant.regionalCounts.shape[0] !== count
              || variant.regionalCounts.shape[1] !== bins) {
              throw new Error(`${feature.id}/${parcellationId} ${variant.axisScale} histogram shape must be [${count}, ${bins}]`);
            }
            addBinaryResource(
              resources,
              statisticsPath,
              variant.regionalCounts,
              `${feature.id}/${parcellationId} ${variant.axisScale} regional histogram`,
            );
          }
        }
      }
    }

    const volume = feature.representations.volume;
    if (!volume) continue;
    const summaryPath = addEncodedResource(
      resources,
      feature.path,
      volume.summaryResource,
      `${feature.id} volume summary`,
    );
    const summaryRaw = await parseJsonResource(files, summaryPath, `${feature.id} volume summary`);
    parseVolumeSummary(summaryRaw, volume);
    const resourceIndexPath = addEncodedResource(
      resources,
      feature.path,
      volume.resourceIndexResource,
      `${feature.id} volume resource index`,
    );
    const resourceIndexRaw = await parseJsonResource(
      files,
      resourceIndexPath,
      `${feature.id} volume resource index`,
    );
    const parsedIndex = parseVolumeResourceIndex(resourceIndexRaw, volume);
    const entries = volume.layout === 'chunks3d'
      ? array(parsedIndex.chunks, `${feature.id} volume chunks`)
      : array(parsedIndex.packs, `${feature.id} volume packs`);
    for (const [index, raw] of entries.entries()) {
      const entry = object(raw, `${feature.id} volume resource ${index}`);
      addEncodedResource(
        resources,
        feature.path,
        entry.resource as EncodedResourceDescriptor,
        `${feature.id} volume resource ${index}`,
      );
    }
    if (volume.validity.kind === 'mask') {
      const mask = parseBinaryArray(volume.validity.mask, `${feature.id} volume validity mask`);
      addBinaryResource(resources, feature.path, mask, `${feature.id} volume validity mask`);
    }
  }

  await validateResourceFiles(files, resources);
  return { document, features };
}
