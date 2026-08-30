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
import { validateDistributionMatchesDisplay } from './distribution.js';
import { parseArtifactDescriptors } from './artifact.js';

interface ArtifactExpectation {
  path: string;
  bytes: number;
  sha256: string;
  decodedBytes: number;
  codec: 'none' | 'gzip';
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
  declaredPaths: readonly string[];
  storedBytes: number;
  declaredDecodedBytes: number;
}

export interface LocalDatasetValidationLimits {
  readonly maximumResourceDecodedBytes: number;
  readonly maximumDecodedBytes: number;
}

export const DEFAULT_LOCAL_DATASET_VALIDATION_LIMITS: LocalDatasetValidationLimits = Object.freeze({
  maximumResourceDecodedBytes: 256 * 1024 * 1024,
  maximumDecodedBytes: 3 * 1024 * 1024 * 1024,
});

export interface LocalDatasetValidationOptions {
  readonly signal?: AbortSignal;
  readonly limits?: LocalDatasetValidationLimits;
}

interface DecodedBudget {
  total: number;
}

function safeNonnegativeInteger(value: number, context: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${context} must be a safe non-negative integer`);
  return value;
}

function checkedAdd(left: number, right: number, context: string): number {
  safeNonnegativeInteger(left, context);
  safeNonnegativeInteger(right, context);
  if (right > Number.MAX_SAFE_INTEGER - left) throw new Error(`${context} exceeds the safe integer range`);
  return left + right;
}

function validationLimits(options: LocalDatasetValidationOptions): LocalDatasetValidationLimits {
  const limits = options.limits ?? DEFAULT_LOCAL_DATASET_VALIDATION_LIMITS;
  safeNonnegativeInteger(limits.maximumResourceDecodedBytes, 'Per-resource decoded byte limit');
  safeNonnegativeInteger(limits.maximumDecodedBytes, 'Aggregate decoded byte limit');
  return limits;
}

function parseArtifacts(value: unknown, baseFile: string, context: string): ArtifactExpectation[] {
  return parseArtifactDescriptors(value, context).map((item, index) => {
    const resource = item.resource;
    const path = resolveRelativePath(
      baseFile,
      resource.path,
      `${context}[${index}].path`,
    );
    return {
      path,
      bytes: resource.bytes,
      sha256: resource.sha256,
      decodedBytes: resource.codec.decodedBytes,
      codec: resource.codec.name,
      context: `${context}[${index}]`,
    };
  });
}

async function readJsonResource(
  files: ReadonlyMap<string, Blob>,
  path: string,
  context: string,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  const file = files.get(path);
  if (!file) throw new Error(`Local dataset is missing ${path} (${context})`);
  try {
    const bytes = await decodedBuffer(file, 'none', path, file.size, signal);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${path} is not valid JSON: ${error.message}`);
    throw error;
  }
}

async function parseJsonResource(
  files: ReadonlyMap<string, Blob>,
  path: string,
  context: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return object(await readJsonResource(files, path, context, signal), context);
}

export async function sha256Hex(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const reader = blob.stream().getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!value) continue;
      length = checkedAdd(length, value.byteLength, 'SHA-256 input byte length');
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    signal?.throwIfAborted();
    const chunk = chunks[index]!;
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
    chunks[index] = new Uint8Array();
  }
  chunks.length = 0;
  // WebCrypto has no cancellable digest API. The signal is checked immediately
  // before and after this bounded encoded-resource operation.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  signal?.throwIfAborted();
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class DecodedLengthError extends Error {}

async function decodedResource(
  blob: Blob,
  codec: 'none' | 'gzip',
  path: string,
  expectedBytes: number,
  signal: AbortSignal | undefined,
  collect: boolean,
): Promise<number | ArrayBuffer> {
  signal?.throwIfAborted();
  safeNonnegativeInteger(expectedBytes, `${path} decoded byte length`);
  if (codec === 'none') {
    if (blob.size !== expectedBytes) {
      throw new DecodedLengthError(`${path} decodes to ${blob.size} bytes; expected ${expectedBytes}`);
    }
    if (!collect) return blob.size;
    const bytes = await blob.arrayBuffer();
    signal?.throwIfAborted();
    return bytes;
  }
  if (!('DecompressionStream' in globalThis)) {
    throw new Error(`Cannot validate gzip resource ${path}: DecompressionStream is unavailable`);
  }
  const output = collect ? new Uint8Array(expectedBytes) : undefined;
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const abort = () => { void reader.cancel(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!value) continue;
      if (value.byteLength > expectedBytes - total) {
        await reader.cancel();
        throw new DecodedLengthError(`${path} decodes to more than ${expectedBytes} bytes`);
      }
      output?.set(value, total);
      total += value.byteLength;
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof DecodedLengthError) throw error;
    throw new Error(`Local resource ${path} is not valid gzip data`);
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  if (total !== expectedBytes) throw new DecodedLengthError(`${path} decodes to ${total} bytes; expected ${expectedBytes}`);
  return output?.buffer ?? total;
}

async function decodedByteLength(
  blob: Blob,
  codec: 'none' | 'gzip',
  path: string,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<number> {
  return await decodedResource(blob, codec, path, expectedBytes, signal, false) as number;
}

async function decodedBuffer(
  blob: Blob,
  codec: 'none' | 'gzip',
  path: string,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  return await decodedResource(blob, codec, path, expectedBytes, signal, true) as ArrayBuffer;
}

function addResource(
  resources: Map<string, ResourceExpectation>,
  expectation: ResourceExpectation,
  budget: DecodedBudget,
  limits: LocalDatasetValidationLimits,
): void {
  if (expectation.bytes !== undefined) safeNonnegativeInteger(expectation.bytes, `${expectation.path} encoded byte length`);
  if (expectation.decodedBytes !== undefined) {
    safeNonnegativeInteger(expectation.decodedBytes, `${expectation.path} decoded byte length`);
    if (expectation.decodedBytes > limits.maximumResourceDecodedBytes) {
      throw new Error(`${expectation.path} exceeds the per-resource decoded-size limit`);
    }
  }
  const existing = resources.get(expectation.path);
  if (!existing) {
    const decodedBytes = expectation.decodedBytes ?? expectation.bytes ?? 0;
    if (decodedBytes > limits.maximumDecodedBytes - budget.total) {
      throw new Error('Local dataset exceeds its aggregate decoded-size limit');
    }
    budget.total += decodedBytes;
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
  const mergedBytes = expectation.bytes ?? existing.bytes;
  const mergedSha256 = expectation.sha256 ?? existing.sha256;
  const mergedDecodedBytes = expectation.decodedBytes ?? existing.decodedBytes;
  const mergedCodec = expectation.codec ?? existing.codec;
  const merged: ResourceExpectation = {
    path: expectation.path,
    context: `${existing.context}; ${expectation.context}`,
    ...(mergedBytes === undefined ? {} : { bytes: mergedBytes }),
    ...(mergedSha256 === undefined ? {} : { sha256: mergedSha256 }),
    ...(mergedDecodedBytes === undefined ? {} : { decodedBytes: mergedDecodedBytes }),
    ...(mergedCodec === undefined ? {} : { codec: mergedCodec }),
  };
  const previousContribution = existing.decodedBytes ?? existing.bytes ?? 0;
  const mergedContribution = merged.decodedBytes ?? merged.bytes ?? 0;
  if (mergedContribution > limits.maximumResourceDecodedBytes) {
    throw new Error(`${expectation.path} exceeds the per-resource decoded-size limit`);
  }
  const totalWithoutExisting = budget.total - previousContribution;
  if (mergedContribution > limits.maximumDecodedBytes - totalWithoutExisting) {
    throw new Error('Local dataset exceeds its aggregate decoded-size limit');
  }
  budget.total = totalWithoutExisting + mergedContribution;
  resources.set(expectation.path, merged);
}

function addBinaryResource(
  resources: Map<string, ResourceExpectation>,
  baseFile: string,
  descriptor: BinaryArrayDescriptor,
  context: string,
  budget: DecodedBudget,
  limits: LocalDatasetValidationLimits,
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
  }, budget, limits);
  return path;
}

function addEncodedResource(
  resources: Map<string, ResourceExpectation>,
  baseFile: string,
  descriptor: EncodedResourceDescriptor,
  context: string,
  budget: DecodedBudget,
  limits: LocalDatasetValidationLimits,
): string {
  const path = resolveRelativePath(baseFile, descriptor.path, context);
  addResource(resources, {
    path,
    context,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
    decodedBytes: descriptor.codec.decodedBytes,
    codec: descriptor.codec.name,
  }, budget, limits);
  return path;
}

async function validateEncodedResource(
  file: Blob,
  resource: ResourceExpectation,
  verified: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (resource.bytes !== undefined && file.size !== resource.bytes) {
    throw new Error(`${resource.path} has ${file.size} bytes; expected ${resource.bytes}`);
  }
  if (!verified.has(resource.path) && resource.sha256) {
    if (await sha256Hex(file, signal) !== resource.sha256) throw new Error(`SHA-256 mismatch for ${resource.path}`);
    verified.add(resource.path);
  }
}

async function readDeclaredJsonResource(
  files: ReadonlyMap<string, Blob>,
  resource: ResourceExpectation,
  context: string,
  verified: Set<string>,
  decodedVerified: Set<string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const file = files.get(resource.path);
  if (!file) throw new Error(`Local dataset is missing ${resource.path} (${resource.context})`);
  await validateEncodedResource(file, resource, verified, signal);
  const expectedBytes = resource.decodedBytes ?? resource.bytes ?? file.size;
  const bytes = await decodedBuffer(file, resource.codec ?? 'none', resource.path, expectedBytes, signal);
  decodedVerified.add(resource.path);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${resource.path} is not valid JSON (${context}): ${error.message}`);
    throw error;
  }
}

async function validateResourceFiles(
  files: ReadonlyMap<string, Blob>,
  resources: ReadonlyMap<string, ResourceExpectation>,
  verified: Set<string>,
  decodedVerified: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  for (const resource of resources.values()) {
    signal?.throwIfAborted();
    const file = files.get(resource.path);
    if (!file) throw new Error(`Local dataset is missing ${resource.path} (${resource.context})`);
    await validateEncodedResource(file, resource, verified, signal);
    if (resource.decodedBytes !== undefined && !decodedVerified.has(resource.path)) {
      await decodedByteLength(file, resource.codec ?? 'none', resource.path, resource.decodedBytes, signal);
      decodedVerified.add(resource.path);
    }
  }
}

/** Validate the complete browser-supported schema-v1 graph before IndexedDB is mutated. */
export async function validateLocalDatasetFiles(
  files: ReadonlyMap<string, Blob>,
  options: LocalDatasetValidationOptions = {},
): Promise<ValidatedLocalDataset> {
  const signal = options.signal;
  const limits = validationLimits(options);
  signal?.throwIfAborted();
  const manifest = files.get('manifest.json');
  if (!manifest) throw new Error('Local dataset is missing manifest.json (manifest)');
  const manifestBytes = safeNonnegativeInteger(manifest.size, 'manifest.json byte length');
  if (manifestBytes > limits.maximumResourceDecodedBytes || manifestBytes > limits.maximumDecodedBytes) {
    throw new Error('manifest.json exceeds the decoded-size limit');
  }
  const budget: DecodedBudget = { total: manifestBytes };
  const verified = new Set<string>();
  const decodedVerified = new Set<string>();
  const manifestRaw = await parseJsonResource(files, 'manifest.json', 'manifest', signal);
  const document = parseDatasetManifestDocument(manifestRaw);
  const resources = new Map<string, ResourceExpectation>();
  for (const featureRef of document.featureRefs) {
    addEncodedResource(resources, 'manifest.json', featureRef.resource, `feature ${featureRef.id}`, budget, limits);
  }
  for (const artifact of parseArtifacts(manifestRaw.artifacts, 'manifest.json', 'manifest.artifacts')) {
    addResource(resources, artifact, budget, limits);
  }

  const regionCounts = new Map<ParcellationId, number>();
  for (const parcel of document.parcellations) {
    signal?.throwIfAborted();
    if (!['int16', 'int32', 'uint16', 'uint32'].includes(parcel.regionIndex.dtype)) {
      throw new Error(`${parcel.id} region index must use an integer dtype`);
    }
    const indexPath = addBinaryResource(
      resources,
      'manifest.json',
      parcel.regionIndex,
      `manifest.parcellations.${parcel.id}.region_index`,
      budget,
      limits,
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
      budget,
      limits,
    );

    const metadata = array(
      await readDeclaredJsonResource(
        files,
        resources.get(parcel.metadata)!,
        `${parcel.id} region metadata`,
        verified,
        decodedVerified,
        signal,
      ),
      `${parcel.id} region metadata`,
    );
    if (metadata.length !== count) throw new Error(`${parcel.id} metadata has ${metadata.length} rows; expected ${count}`);
    const regionIdsFile = files.get(indexPath);
    if (!regionIdsFile) throw new Error(`Local dataset is missing ${indexPath}`);
    const regionIds = decodeBinaryArray(
      await (async () => {
        const expectation = resources.get(indexPath)!;
        await validateEncodedResource(regionIdsFile, expectation, verified, signal);
        const buffer = await decodedBuffer(regionIdsFile, parcel.regionIndex.codec.name, indexPath, parcel.regionIndex.codec.decodedBytes, signal);
        decodedVerified.add(indexPath);
        return buffer;
      })(),
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
    signal?.throwIfAborted();
    const featureRaw = object(
      await readDeclaredJsonResource(
        files,
        resources.get(featureRef.path)!,
        `feature ${featureRef.path}`,
        verified,
        decodedVerified,
        signal,
      ),
      `feature ${featureRef.path}`,
    );
    const feature = parseFeatureDescriptor(featureRaw, featureRef.path);
    if (feature.id !== featureRef.id) {
      throw new Error(`Feature id mismatch for ${featureRef.path}: expected ${featureRef.id}, got ${feature.id}`);
    }
    features.push(feature);
    for (const artifact of parseArtifacts(featureRaw.artifacts, featureRef.path, `${featureRef.path}.artifacts`)) {
      addResource(resources, artifact, budget, limits);
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
        addBinaryResource(resources, feature.path, descriptor.values, `${feature.id}/${parcellationId} values`, budget, limits);
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
          budget,
          limits,
        );
        const statistics = parseStatisticsDocument(
          await readDeclaredJsonResource(
            files,
            resources.get(statisticsPath)!,
            `${feature.id}/${parcellationId} statistics`,
            verified,
            decodedVerified,
            signal,
          ),
        );
        if (statistics.values.shape.length !== 2
          || statistics.values.shape[0] !== count
          || statistics.values.shape[1] !== statistics.fields.length) {
          throw new Error(`${feature.id}/${parcellationId} statistics shape must be [${count}, ${statistics.fields.length}]`);
        }
        const summaryValuesPath = addBinaryResource(
          resources,
          statisticsPath,
          statistics.values,
          `${feature.id}/${parcellationId} regional summary`,
          budget,
          limits,
        );
        const countField = statistics.fields.indexOf('count');
        if (countField < 0) throw new Error(`${feature.id}/${parcellationId} regional statistics require count`);
        const summaryValuesFile = files.get(summaryValuesPath);
        if (!summaryValuesFile) throw new Error(`Local dataset is missing ${summaryValuesPath}`);
        const summaryValues = decodeBinaryArray(
          await (async () => {
            const expectation = resources.get(summaryValuesPath)!;
            await validateEncodedResource(summaryValuesFile, expectation, verified, signal);
            const buffer = await decodedBuffer(summaryValuesFile, statistics.values.codec.name, summaryValuesPath, statistics.values.codec.decodedBytes, signal);
            decodedVerified.add(summaryValuesPath);
            return buffer;
          })(),
          { ...statistics.values, path: summaryValuesPath },
        );
        const regionalDisplay = feature.display?.regional;
        if (!regionalDisplay) throw new Error(`${feature.id} has no regional display contract`);
        const distributionBinnings = statistics.distribution?.binnings ?? [];
        if (statistics.distribution) {
          validateDistributionMatchesDisplay(
            distributionBinnings,
            regionalDisplay,
            `${feature.id}/${parcellationId}`,
          );
        }
        for (const binning of distributionBinnings) {
          if (!binning.regionalCounts) throw new Error(`${feature.id}/${parcellationId}/${binning.id} has no regional counts`);
          const regionalCounts = binning.regionalCounts;
          const rowWidth = binning.edges.length + 1;
          if (regionalCounts.shape.length !== 2
            || regionalCounts.shape[0] !== count
            || regionalCounts.shape[1] !== rowWidth) {
            throw new Error(`${feature.id}/${parcellationId} ${binning.id} distribution shape must be [${count}, ${rowWidth}]`);
          }
          const countsPath = addBinaryResource(
            resources,
            statisticsPath,
            regionalCounts,
            `${feature.id}/${parcellationId} ${binning.id} regional distribution`,
            budget,
            limits,
          );
          const countsFile = files.get(countsPath);
          if (!countsFile) throw new Error(`Local dataset is missing ${countsPath}`);
          const distributionCounts = decodeBinaryArray(
            await (async () => {
              const expectation = resources.get(countsPath)!;
              await validateEncodedResource(countsFile, expectation, verified, signal);
              const buffer = await decodedBuffer(countsFile, regionalCounts.codec.name, countsPath, regionalCounts.codec.decodedBytes, signal);
              decodedVerified.add(countsPath);
              return buffer;
            })(),
            { ...regionalCounts, path: countsPath },
          );
          for (let row = 0; row < count; row += 1) {
            const populationCount = summaryValues[row * statistics.fields.length + countField];
            const start = row * rowWidth;
            const distributionCount = distributionCounts
              .slice(start, start + rowWidth)
              .reduce((sum, value) => sum + value, 0);
            if (distributionCount !== populationCount) {
              throw new Error(`${feature.id}/${parcellationId}/${binning.id} region ${row} does not conserve its population`);
            }
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
      budget,
      limits,
    );
    const summaryRaw = await readDeclaredJsonResource(files, resources.get(summaryPath)!, `${feature.id} volume summary`, verified, decodedVerified, signal);
    const summary = parseVolumeSummary(summaryRaw, volume);
    const volumeDisplay = feature.display?.volume;
    if (!volumeDisplay) throw new Error(`${feature.id} has no volume display contract`);
    if (summary.distribution) {
      validateDistributionMatchesDisplay(summary.distribution.binnings, volumeDisplay, `${feature.id}/volume`);
    }
    const resourceIndexPath = addEncodedResource(
      resources,
      feature.path,
      volume.resourceIndexResource,
      `${feature.id} volume resource index`,
      budget,
      limits,
    );
    const resourceIndexRaw = await readDeclaredJsonResource(
      files,
      resources.get(resourceIndexPath)!,
      `${feature.id} volume resource index`,
      verified,
      decodedVerified,
      signal,
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
        budget,
        limits,
      );
    }
    if (volume.validity.kind === 'mask') {
      addBinaryResource(
        resources,
        feature.path,
        volume.validity.mask.resource,
        `${feature.id} volume validity mask`,
        budget,
        limits,
      );
    }
  }

  const declaredPaths = ['manifest.json', ...resources.keys()].sort();
  const declared = new Set(declaredPaths);
  const undeclared = [...files.keys()].filter((path) => !declared.has(path)).sort();
  if (undeclared.length) {
    throw new Error(`Local dataset contains undeclared files: ${undeclared.slice(0, 8).join(', ')}`);
  }
  await validateResourceFiles(files, resources, verified, decodedVerified, signal);
  const storedBytes = declaredPaths.reduce(
    (total, path) => checkedAdd(total, files.get(path)?.size ?? 0, 'Stored byte total'),
    0,
  );
  return { document, features, declaredPaths, storedBytes, declaredDecodedBytes: budget.total };
}
