import { SCHEMA_VERSION, type DatasetManifest, type FeatureDescriptor, type VolumeFeaturePayload } from './contracts.js';
import type { ResourceReader } from './resource-reader.js';
import { createVolumeRegionalDistributionLoader } from './volume-regional-loader.js';
import { parseVolumeResourceIndex, parseVolumeSummary } from './validation/volume-v1.js';
import { validateDistributionMatchesDisplay } from './validation/distribution.js';

/** Shared schema-v1 materialization; readers retain transport and integrity ownership. */
export async function loadVolumeFeatureFromResources(options: {
  reader: ResourceReader;
  featureLocation: string;
  feature: FeatureDescriptor;
  parcellationDescriptors: DatasetManifest['parcellationDescriptors'];
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<VolumeFeaturePayload> {
  const { reader, featureLocation, feature, parcellationDescriptors, baseUrl, signal } = options;
  const featureId = feature.id;
  const descriptor = feature.representations.volume;
  if (!descriptor) throw new Error(`Feature ${feature.id} has no volume representation`);
  const [resourceIndexRaw, summaryRaw] = await Promise.all([
    reader.readJson(
      reader.resolve(featureLocation, descriptor.resourceIndexPath),
      signal,
      descriptor.resourceIndexResource,
    ),
    reader.readJson(
      reader.resolve(featureLocation, descriptor.summaryPath),
      signal,
      descriptor.summaryResource,
    ),
  ]);
  const summary = parseVolumeSummary(
    summaryRaw,
    descriptor,
    Object.fromEntries(Object.entries(parcellationDescriptors)
      .map(([id, item]) => [id, item!.regionIndex.shape[0]!])),
  );
  const display = feature.display?.volume;
  if (!display) throw new Error(`Feature ${feature.id} has no volume display contract`);
  if (summary.distribution) {
    validateDistributionMatchesDisplay(summary.distribution.binnings, display, `${feature.id}/volume`);
  }
  const resolvedDescriptor = {
    ...descriptor,
    resource: parseVolumeResourceIndex(resourceIndexRaw, descriptor),
  };
  const loadRegionalDistribution = createVolumeRegionalDistributionLoader({
    reader,
    featureLocation,
    summaryPath: descriptor.summaryPath,
    summary,
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    featureId,
    representation: 'volume',
    descriptor: resolvedDescriptor,
    summary,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    loadResource: (path, resourceSignal, resource) => reader.readBytes(
      reader.resolve(featureLocation, path),
      resourceSignal,
      resource,
    ),
    loadRegionalDistribution,
  };
}
