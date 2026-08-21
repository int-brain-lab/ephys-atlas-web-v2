import type { ParcellationId } from '../../domain/types.js';
import type {
  BinaryArrayDescriptor,
  FeatureDescriptor,
  DatasetManifestDocument,
} from '../contracts.js';
import { binaryBytes, bytesPerElement, decodeBinaryArray } from './binary.js';
import { parseFeatureDescriptor } from './feature.js';
import { parseDatasetManifestDocument } from './manifest.js';
import {
  array,
  integerArray,
  object,
  relativePath,
  resolveRelativePath,
  SHA256,
  string,
  templatePath,
} from './primitives.js';
import { parseStatisticsDocument } from './statistics.js';

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
  return array(value, context).map((raw, index) => {
    const item = object(raw, `${context}[${index}]`);
    const id = string(item.id, `${context}[${index}].id`);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`${context}[${index}].id has an invalid format`);
    if (!['current-feature', 'selected-data', 'source-snapshot', 'auxiliary'].includes(String(item.role))) {
      throw new Error(`${context}[${index}].role is unsupported`);
    }
    string(item.media_type, `${context}[${index}].media_type`);
    if (typeof item.bytes !== 'number' || !Number.isInteger(item.bytes) || item.bytes < 0) {
      throw new Error(`${context}[${index}].bytes must be a non-negative integer`);
    }
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      throw new Error(`${context}[${index}].sha256 must be 64 lowercase hexadecimal characters`);
    }
    const path = resolveRelativePath(
      baseFile,
      relativePath(item.path, `${context}[${index}].path`),
      `${context}[${index}].path`,
    );
    return { path, bytes: item.bytes, sha256: item.sha256, context: `${context}[${index}]` };
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
  if (descriptor.bytes !== undefined && descriptor.bytes !== expectedBytes) {
    throw new Error(`${context}.bytes is ${descriptor.bytes}; dtype and shape require ${expectedBytes}`);
  }
  addResource(resources, {
    path,
    context,
    bytes: expectedBytes,
    ...(descriptor.sha256 ? { sha256: descriptor.sha256 } : {}),
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

/** Validate the complete browser-supported schema-v0.1 graph before IndexedDB is mutated. */
export async function validateLocalDatasetFiles(
  files: ReadonlyMap<string, Blob>,
): Promise<ValidatedLocalDataset> {
  const manifestRaw = await parseJsonResource(files, 'manifest.json', 'manifest');
  const document = parseDatasetManifestDocument(manifestRaw);
  const resources = new Map<string, ResourceExpectation>();
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
    addResource(resources, { path: parcel.metadata, context: `manifest.parcellations.${parcel.id}.metadata` });

    const metadata = array(
      await readJsonResource(files, parcel.metadata, `${parcel.id} region metadata`),
      `${parcel.id} region metadata`,
    );
    if (metadata.length !== count) throw new Error(`${parcel.id} metadata has ${metadata.length} rows; expected ${count}`);
    const regionIdsFile = files.get(indexPath);
    if (!regionIdsFile) throw new Error(`Local dataset is missing ${indexPath}`);
    const regionIds = decodeBinaryArray(
      await regionIdsFile.arrayBuffer(),
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
        addResource(resources, { path: statisticsPath, context: `${feature.id}/${parcellationId} statistics` });
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
          const bins = statistics.histogram.edges.length - 1;
          if (statistics.histogram.regionalCounts.shape.length !== 2
            || statistics.histogram.regionalCounts.shape[0] !== count
            || statistics.histogram.regionalCounts.shape[1] !== bins) {
            throw new Error(`${feature.id}/${parcellationId} histogram shape must be [${count}, ${bins}]`);
          }
          addBinaryResource(
            resources,
            statisticsPath,
            statistics.histogram.regionalCounts,
            `${feature.id}/${parcellationId} regional histogram`,
          );
        }
      }
    }

    const volume = feature.representations.volume;
    if (!volume) continue;
    const volumePaths = new Set<string>();
    if (volume.statistics) {
      const statisticsPath = resolveRelativePath(feature.path, volume.statistics, `${feature.id} volume statistics`);
      addResource(resources, { path: statisticsPath, context: `${feature.id} volume statistics` });
      await parseJsonResource(files, statisticsPath, `${feature.id} volume statistics`);
    }
    const elementBytes = bytesPerElement(volume.array.dtype);
    if (volume.layout === 'chunks3d') {
      const chunkShape = integerArray(volume.resource.shape, 3, `${feature.id}.volume.chunks.shape`);
      const codecRaw = object(volume.resource.codec, `${feature.id}.volume.chunks.codec`);
      if (codecRaw.name !== 'none' && codecRaw.name !== 'gzip') {
        throw new Error(`${feature.id}.volume.chunks.codec.name is unsupported`);
      }
      const codec = codecRaw.name;
      const template = relativePath(volume.resource.path_template, `${feature.id}.volume.chunks.path_template`);
      if (!['{i0}', '{i1}', '{i2}'].every((field) => template.includes(field))) {
        throw new Error(`${feature.id}.volume.chunks.path_template must contain {i0}, {i1}, and {i2}`);
      }
      const chunkCounts = volume.grid.shape.map((size, dimension) => Math.ceil(size / chunkShape[dimension]!));
      for (let i0 = 0; i0 < chunkCounts[0]!; i0 += 1) {
        for (let i1 = 0; i1 < chunkCounts[1]!; i1 += 1) {
          for (let i2 = 0; i2 < chunkCounts[2]!; i2 += 1) {
            const indices = [i0, i1, i2];
            const actualShape = volume.grid.shape.map((size, dimension) =>
              Math.min(chunkShape[dimension]!, size - indices[dimension]! * chunkShape[dimension]!));
            const decodedBytes = actualShape.reduce((product, size) => product * size, elementBytes);
            const path = resolveRelativePath(
              feature.path,
              templatePath(template, { i0, i1, i2 }, `${feature.id}.volume.chunks.path_template`),
              `${feature.id} volume chunk`,
            );
            if (volumePaths.has(path)) throw new Error(`${feature.id} volume resource template does not produce unique paths`);
            volumePaths.add(path);
            addResource(resources, { path, context: `${feature.id} volume chunk`, decodedBytes, codec });
          }
        }
      }
    } else {
      const packDepth = volume.resource.pack_depth;
      if (typeof packDepth !== 'number' || !Number.isInteger(packDepth) || packDepth <= 0) {
        throw new Error(`${feature.id}.volume.slice_packs.pack_depth must be a positive integer`);
      }
      const axes = object(volume.resource.axes, `${feature.id}.volume.slice_packs.axes`);
      for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
        const axisResource = object(axes[axis], `${feature.id}.volume.slice_packs.axes.${axis}`);
        const sliceShape = integerArray(axisResource.slice_shape, 2, `${feature.id}.volume.slice_packs.axes.${axis}.slice_shape`);
        const codecRaw = object(axisResource.codec, `${feature.id}.volume.slice_packs.axes.${axis}.codec`);
        if (codecRaw.name !== 'none' && codecRaw.name !== 'gzip') {
          throw new Error(`${feature.id}.volume.slice_packs.axes.${axis}.codec.name is unsupported`);
        }
        const template = relativePath(axisResource.path_template, `${feature.id}.volume.slice_packs.axes.${axis}.path_template`);
        if (!template.includes('{pack}')) {
          throw new Error(`${feature.id}.volume.slice_packs.axes.${axis}.path_template must contain {pack}`);
        }
        const dimensionName = axis === 'coronal' ? 'ap' : axis === 'sagittal' ? 'ml' : 'dv';
        const dimension = volume.grid.axisOrder.findIndex((name) => name.toLowerCase() === dimensionName);
        if (dimension < 0) throw new Error(`${feature.id}.volume.grid.axis_order does not contain ${dimensionName}`);
        const sliceCount = volume.grid.shape[dimension]!;
        const expectedSliceShape = volume.grid.shape.filter((_, index) => index !== dimension);
        if (sliceShape[0] !== expectedSliceShape[0] || sliceShape[1] !== expectedSliceShape[1]) {
          throw new Error(`${feature.id}.volume.slice_packs.axes.${axis}.slice_shape is inconsistent with the grid`);
        }
        for (let pack = 0; pack < Math.ceil(sliceCount / packDepth); pack += 1) {
          const depth = Math.min(packDepth, sliceCount - pack * packDepth);
          const decodedBytes = sliceShape[0]! * sliceShape[1]! * depth * elementBytes;
          const path = resolveRelativePath(
            feature.path,
            templatePath(template, { pack }, `${feature.id}.volume.slice_packs.axes.${axis}.path_template`),
            `${feature.id} ${axis} slice pack`,
          );
          if (volumePaths.has(path)) throw new Error(`${feature.id} volume resource template does not produce unique paths`);
          volumePaths.add(path);
          addResource(resources, {
            path,
            context: `${feature.id} ${axis} slice pack`,
            decodedBytes,
            codec: codecRaw.name,
          });
        }
      }
    }
  }

  await validateResourceFiles(files, resources);
  return { document, features };
}
