import type { ParcellationId } from '../../domain/types.js';
import type { EncodedResourceDescriptor, FeatureDescriptor, DatasetManifestDocument } from '../contracts.js';
import { decodeBinaryArray } from './binary.js';
import { parseFeatureDescriptor } from './feature.js';
import { parseDatasetManifestDocument } from './manifest.js';
import { array, object, resolveRelativePath, string } from './primitives.js';
import { parseStatisticsDocument } from './statistics.js';
import { parseVolumeResourceIndex, parseVolumeSummary } from './volume-v1.js';
import { validateDistributionMatchesDisplay } from './distribution.js';
import { metadataJsonResources, parseMetadataBundle, validateMetadataBundle } from './metadata-bundle.js';

import { type ResourceExpectation, type LocalDatasetValidationOptions, type DecodedBudget, safeNonnegativeInteger, checkedAdd, validationLimits, parseArtifacts, parseJsonResource, decodedBuffer, addResource, addBinaryResource, addEncodedResource, validateEncodedResource, readDeclaredJsonResource, validateResourceFiles } from './local-resource-validation.js';
export { DEFAULT_LOCAL_DATASET_VALIDATION_LIMITS, sha256Hex } from './local-resource-validation.js';
export type { LocalDatasetValidationLimits, LocalDatasetValidationOptions } from './local-resource-validation.js';

export interface ValidatedLocalDataset {
  document: DatasetManifestDocument;
  features: readonly FeatureDescriptor[];
  declaredPaths: readonly string[];
  storedBytes: number;
  declaredDecodedBytes: number;
}

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
    const summary = parseVolumeSummary(
      summaryRaw,
      volume,
      Object.fromEntries(regionCounts),
    );
    const volumeDisplay = feature.display?.volume;
    if (!volumeDisplay) throw new Error(`${feature.id} has no volume display contract`);
    if (summary.distribution) {
      validateDistributionMatchesDisplay(summary.distribution.binnings, volumeDisplay, `${feature.id}/volume`);
    }
    for (const companion of summary.regionalDistributions ?? []) {
      for (const binning of companion.binnings) {
        const countsPath = addBinaryResource(
          resources,
          summaryPath,
          binning.regionalCounts,
          `${feature.id}/${companion.parcellationId}/${binning.binningId} volume regional distribution`,
          budget,
          limits,
        );
        const countsFile = files.get(countsPath);
        if (!countsFile) throw new Error(`Local dataset is missing ${countsPath}`);
        const counts = decodeBinaryArray(
          await (async () => {
            const expectation = resources.get(countsPath)!;
            await validateEncodedResource(countsFile, expectation, verified, signal);
            const buffer = await decodedBuffer(
              countsFile,
              binning.regionalCounts.codec.name,
              countsPath,
              binning.regionalCounts.codec.decodedBytes,
              signal,
            );
            decodedVerified.add(countsPath);
            return buffer;
          })(),
          { ...binning.regionalCounts, path: countsPath },
        );
        const assigned = counts.reduce((sum, count) => sum + count, 0);
        if (assigned !== companion.assignedValidVoxelCount) {
          throw new Error(`${feature.id}/${companion.parcellationId}/${binning.binningId} does not conserve assigned valid voxels`);
        }
      }
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

  if (document.metadataBundle) {
    const path = addEncodedResource(resources, 'manifest.json', document.metadataBundle, 'metadata bundle', budget, limits);
    const bundle = parseMetadataBundle(await readDeclaredJsonResource(files, resources.get(path)!, 'metadata bundle', verified, decodedVerified, signal));
    await validateMetadataBundle(bundle, metadataJsonResources(document, features));
    signal?.throwIfAborted();
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
