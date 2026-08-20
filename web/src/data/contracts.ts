import type {
  DatasetId,
  DatasetRef,
  ParcellationId,
  RepresentationKind,
  StatisticId,
} from '../domain/types.js';

export const SCHEMA_VERSION = '0.1' as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

export type BinaryDType = 'int16' | 'int32' | 'uint16' | 'uint32' | 'float16' | 'float32' | 'float64';

export interface BinaryArrayDescriptor {
  path: string;
  dtype: BinaryDType;
  shape: readonly number[];
  order: 'C';
  endianness: 'little' | 'not-applicable';
  sha256?: string;
  bytes?: number;
}

export interface DatasetReleaseSummary {
  id: string;
  label: string;
  manifest: string;
  immutable: boolean;
}

export interface DatasetCatalogEntry {
  id: DatasetId;
  title: string;
  description?: string;
  releases: readonly DatasetReleaseSummary[];
  defaultRelease: string;
}

/** Mutable publication index. Release manifests themselves follow schema v0.1. */
export interface DatasetCatalog {
  schemaVersion: SchemaVersion;
  datasets: readonly DatasetCatalogEntry[];
}

export interface FeatureReference {
  id: string;
  path: string;
}

export interface ParcellationDescriptor {
  id: ParcellationId;
  regionIndex: BinaryArrayDescriptor;
  metadata?: string;
}

export interface RegionMetadata {
  /** Stable atlas ID used by scientific payloads, browser selection, and URLs. */
  id: string;
  atlasId: number;
  index: number;
  acronym: string;
  name: string;
  parentId?: string | null;
  depth?: number;
}

export interface DatasetManifestDocument {
  schemaVersion: SchemaVersion;
  datasetId: string;
  title: string;
  description: string;
  release: {
    releaseId: string;
    immutable: boolean;
    createdAt: string;
    paperSnapshot: boolean;
  };
  parcellations: readonly ParcellationDescriptor[];
  featureRefs: readonly FeatureReference[];
}

export interface RegionalParcellationDescriptor {
  parcellationId: ParcellationId;
  summary: string;
  values: BinaryArrayDescriptor;
  statistics: string;
}

export interface RegionalRepresentationDescriptor {
  kind: 'regional';
  format: 'ephys-atlas-regional-v0.1';
  parcellations: Partial<Record<ParcellationId, RegionalParcellationDescriptor>>;
}

export interface VolumeGridDescriptor {
  shape: readonly [number, number, number];
  axisOrder: readonly [string, string, string];
  coordinateSystem: string;
  voxelSizeUm: readonly [number, number, number];
  originUm: readonly [number, number, number];
  indexToWorldUm: readonly number[];
}

export interface VolumeArrayDescriptor {
  dtype: BinaryDType;
  endianness: 'little' | 'not-applicable';
  order: 'C';
  nonfinite: 'preserve' | 'forbid';
}

export interface VolumeRepresentationDescriptor {
  kind: 'volume';
  format: 'ephys-atlas-chunked-volume-v0.1';
  layout: 'chunks3d' | 'orthogonal_slice_packs';
  grid: VolumeGridDescriptor;
  array: VolumeArrayDescriptor;
  resource: Record<string, unknown>;
  statistics?: string;
  valueRange?: readonly [number | null, number | null];
}

export interface FeatureDescriptor {
  id: string;
  path: string;
  label: string;
  description: string;
  unit: string | null;
  statistics: readonly StatisticId[];
  representations: {
    regional?: RegionalRepresentationDescriptor;
    volume?: VolumeRepresentationDescriptor;
  };
}

/** Resolved browser view of a schema-v0.1 manifest plus its feature metadata. */
export interface DatasetManifest {
  schemaVersion: SchemaVersion;
  dataset: {
    id: DatasetId;
    release: string;
    title: string;
    description?: string;
    fixture?: boolean;
  };
  parcellations: readonly ParcellationId[];
  parcellationDescriptors: Partial<Record<ParcellationId, ParcellationDescriptor>>;
  features: readonly FeatureDescriptor[];
}

export interface GlobalStatistics {
  count?: number;
  missingCount?: number;
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
  median?: number;
  q05?: number;
  q25?: number;
  q75?: number;
  q95?: number;
}

export interface RegionalHistogram {
  edges: readonly number[];
  globalCounts: readonly number[];
  /** One row per regionId, one column per histogram bin. */
  regionalCounts?: readonly (readonly number[])[];
  binRule?: string;
}

export interface RegionalFeaturePayload {
  schemaVersion: SchemaVersion;
  featureId: string;
  representation: 'regional';
  parcellation: ParcellationId;
  regionIds: readonly string[];
  statistics: Partial<Record<StatisticId, readonly number[]>>;
  population?: string;
  global?: GlobalStatistics;
  histogram?: RegionalHistogram;
}

export interface VolumeFeaturePayload {
  schemaVersion: SchemaVersion;
  featureId: string;
  representation: 'volume';
  descriptor: VolumeRepresentationDescriptor;
  /** Resolve a path relative to the feature metadata regardless of HTTP vs local transport. */
  loadResource(path: string, signal?: AbortSignal): Promise<ArrayBuffer>;
  /** Optional browser-visible base URL retained for download/debug surfaces. */
  baseUrl?: string;
}

export type FeaturePayload = RegionalFeaturePayload | VolumeFeaturePayload;

export interface DatasetSource {
  readonly kind: 'published' | 'local';
  loadCatalog(): Promise<DatasetCatalog>;
  loadManifest(ref: DatasetRef): Promise<DatasetManifest>;
  loadRegions(ref: DatasetRef, parcellation: ParcellationId): Promise<readonly RegionMetadata[]>;
  loadFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<FeaturePayload>;
  prefetchFeature?(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<void>;
}
