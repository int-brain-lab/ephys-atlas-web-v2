import type { ParcellationId, VolumeRegionHemisphere } from '../domain/types.js';
import type {
  DistributionBinning,
  DistributionCounts,
  RegionMetadata,
  VolumeFeatureSummary,
} from './contracts.js';
import type { ResourceReader } from './resource-reader.js';

export async function loadVolumeRegionalDistribution(options: {
  reader: ResourceReader;
  featureLocation: string;
  summaryPath: string;
  summary: VolumeFeatureSummary;
  parcellation: ParcellationId;
  binningId: string;
  signal?: AbortSignal;
}): Promise<DistributionBinning> {
  const {
    reader,
    featureLocation,
    summaryPath,
    summary,
    parcellation,
    binningId,
    signal,
  } = options;
  const companion = summary.regionalDistributions?.find(
    (item) => item.parcellationId === parcellation,
  );
  if (!companion) throw new Error(`Volume has no ${parcellation} regional distribution`);
  const resource = companion.binnings.find((item) => item.binningId === binningId);
  if (!resource) throw new Error(`Volume has no ${parcellation}/${binningId} regional distribution`);
  const global = summary.distribution?.binnings.find((item) => item.id === binningId);
  if (!global) throw new Error(`Volume has no ${binningId} global distribution`);
  const summaryLocation = reader.resolve(featureLocation, summaryPath);
  const flat = await reader.readArray(
    reader.resolve(summaryLocation, resource.regionalCounts.path),
    resource.regionalCounts,
    signal,
  );
  const rowCount = resource.regionalCounts.shape[0]!;
  const rowWidth = global.edges.length + 1;
  if (flat.length !== rowCount * rowWidth) {
    throw new Error(`${parcellation}/${binningId} regional distribution payload length is inconsistent`);
  }
  const regional = Array.from({ length: rowCount }, (_, row) => {
    const offset = row * rowWidth;
    return {
      underflowCount: flat[offset]!,
      binCounts: flat.slice(offset + 1, offset + global.edges.length),
      overflowCount: flat[offset + rowWidth - 1]!,
    };
  });
  const total = regional.reduce(
    (sum, counts) => sum + counts.underflowCount
      + counts.binCounts.reduce((subtotal, count) => subtotal + count, 0)
      + counts.overflowCount,
    0,
  );
  if (total !== companion.assignedValidVoxelCount) {
    throw new Error(`${parcellation}/${binningId} regional distribution does not conserve assigned valid voxels`);
  }
  return { ...global, regional };
}

export function createVolumeRegionalDistributionLoader(options: {
  reader: ResourceReader;
  featureLocation: string;
  summaryPath: string;
  summary: VolumeFeatureSummary;
}): (
  parcellation: ParcellationId,
  binningId: string,
  signal?: AbortSignal,
) => Promise<DistributionBinning> {
  const cache = new Map<string, DistributionBinning>();
  return async (parcellation, binningId, signal) => {
    const key = `${parcellation}/${binningId}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const loaded = await loadVolumeRegionalDistribution({
      ...options,
      parcellation,
      binningId,
      ...(signal ? { signal } : {}),
    });
    if (!signal?.aborted) cache.set(key, loaded);
    return loaded;
  };
}

export function selectVolumeRegionDistribution(
  distribution: DistributionBinning,
  regions: readonly RegionMetadata[],
  regionId: string | number,
  hemisphere: VolumeRegionHemisphere,
): DistributionCounts | null {
  if (!distribution.regional || distribution.regional.length !== regions.length) {
    throw new Error('Volume regional distribution rows do not match region metadata');
  }
  const logicalId = Math.abs(Number(regionId));
  if (!Number.isSafeInteger(logicalId) || logicalId === 0) return null;
  const signs = hemisphere === 'left' ? [-1] : hemisphere === 'right' ? [1] : [-1, 1];
  const rows = signs.map((sign) => regions.findIndex((region) => region.atlasId === sign * logicalId))
    .filter((row) => row >= 0);
  if (rows.length === 0) return null;
  const binCount = distribution.edges.length - 1;
  return rows.reduce<DistributionCounts>((sum, row) => {
    const counts = distribution.regional![row]!;
    return {
      underflowCount: sum.underflowCount + counts.underflowCount,
      binCounts: sum.binCounts.map((value, index) => value + counts.binCounts[index]!),
      overflowCount: sum.overflowCount + counts.overflowCount,
    };
  }, { underflowCount: 0, binCounts: Array(binCount).fill(0), overflowCount: 0 });
}
