import type {
  DatasetId,
  DatasetRef,
  ParcellationId,
  RepresentationKind,
  StatisticId,
} from '../domain/types.js';
import type { ScaleSpec } from '../domain/scale-spec.js';

export const SCHEMA_VERSION = '1.0' as const;
export type SchemaVersion = typeof SCHEMA_VERSION;
export type BinaryDType =
  | 'uint8'
  | 'int16'
  | 'int32'
  | 'uint16'
  | 'uint32'
  | 'float16'
  | 'float32'
  | 'float64';

export interface EncodedResourceDescriptor {
  path: string;
  mediaType: string;
  sha256: string;
  bytes: number;
  codec: { name: 'none' | 'gzip'; decodedBytes: number; level?: number };
}

export type ArtifactRole =
  | 'current-feature'
  | 'selected-data'
  | 'source-snapshot'
  | 'auxiliary'
  | 'whole-release';

export interface ArtifactDescriptor {
  id: string;
  role: ArtifactRole;
  resource: EncodedResourceDescriptor;
  description?: string;
}

export interface ArtifactPayload {
  artifact: ArtifactDescriptor;
  bytes: ArrayBuffer;
}

export interface BinaryArrayDescriptor extends EncodedResourceDescriptor {
  format: 'raw-binary-array-v1';
  dtype: BinaryDType;
  shape: readonly number[];
  order: 'C';
  endianness: 'little' | 'not-applicable';
}

export interface DatasetReleaseSummary {
  id: string;
  label: string;
  manifest: string;
  manifestResource?: EncodedResourceDescriptor;
  immutable: boolean;
}

export interface DatasetCatalogEntry {
  id: DatasetId;
  title: string;
  description?: string;
  releases: readonly DatasetReleaseSummary[];
  defaultRelease: string;
}

export interface DatasetCatalog {
  schemaVersion: SchemaVersion;
  datasets: readonly DatasetCatalogEntry[];
}

export interface FeatureReference {
  id: string;
  path: string;
  resource: EncodedResourceDescriptor;
}

export interface ParcellationDescriptor {
  id: ParcellationId;
  regionIndex: BinaryArrayDescriptor;
  metadata?: string;
  metadataResource?: EncodedResourceDescriptor;
}

export interface ReleasePublication {
  doi?: string;
  label?: string;
}

export interface ReleaseMetadata {
  releaseId: string;
  immutable: true;
  createdAt: string;
  paperSnapshot: boolean;
  publication?: ReleasePublication;
}

export type ProvenanceSourceRole =
  | 'scientific-code'
  | 'canonical-data'
  | 'selection-freeze'
  | 'publication-input'
  | 'user-input'
  | 'atlas-geometry';

export interface ProvenanceSource {
  role: ProvenanceSourceRole;
  description: string;
  repository?: string;
  commit?: string;
  path?: string;
  release?: string;
  uri?: string;
  sha256?: string;
  license?: string;
}

export interface ProvenanceBuilder {
  name: string;
  version: string;
  command: string;
  repository?: string;
  commit?: string;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface DatasetProvenance {
  sources: readonly ProvenanceSource[];
  builder: ProvenanceBuilder;
  recipe: Readonly<Record<string, JsonValue>> & { readonly id: string };
  notes: readonly string[];
}

export interface RegionMetadata {
  id: string;
  atlasId: number;
  index: number;
  acronym: string;
  name: string;
  parentId?: string | null;
  depth?: number;
  colorHex?: string;
  mappingMember?: boolean;
}

export interface DatasetManifestDocument {
  schemaVersion: SchemaVersion;
  datasetId: string;
  title: string;
  description: string;
  release: ReleaseMetadata;
  provenance: DatasetProvenance;
  artifacts: readonly ArtifactDescriptor[];
  parcellations: readonly ParcellationDescriptor[];
  featureRefs: readonly FeatureReference[];
}

export interface FeatureValueSemantics {
  quantity: string;
  transform: string;
  sourcePopulation: string;
  missingValues: string;
  sourceColumn?: string;
  qcFilter?: string;
}

export interface DistributionFullDomainSpec {
  kind: 'full';
}

export interface DistributionFocusedDomainSpec {
  kind: 'focused';
  bounds: readonly [number, number];
}

export type DistributionDomainSpec = DistributionFullDomainSpec | DistributionFocusedDomainSpec;

export interface RepresentationDisplay {
  colormap?: string;
  divergingCenter?: number;
  range?: readonly [number, number];
  scales: readonly ScaleSpec[];
  preferredScale: ScaleSpec['kind'];
  distributionDomains: readonly DistributionDomainSpec[];
  preferredDistributionDomain: DistributionDomainSpec['kind'];
}

export interface FeatureDisplay {
  regional?: RepresentationDisplay;
  volume?: RepresentationDisplay;
}

export interface RegionalParcellationDescriptor {
  parcellationId: ParcellationId;
  summary: string;
  values: BinaryArrayDescriptor;
  statistics: string;
  statisticsResource: EncodedResourceDescriptor;
}

export interface RegionalRepresentationDescriptor {
  kind: 'regional';
  format: 'ephys-atlas-regional-v1';
  parcellations: Partial<Record<ParcellationId, RegionalParcellationDescriptor>>;
}

export interface VolumeGridDescriptor {
  referenceSpaceId: string;
  gridId: string;
  shape: readonly [number, number, number];
  axisOrder: readonly [string, string, string];
  coordinateSystem: string;
  voxelSizeUm: readonly [number, number, number];
  originUm: readonly [number, number, number];
  indexToWorldUm: readonly number[];
  worldToIndex: readonly number[];
  voxelEdgeExtentUm: readonly [number, number, number, number, number, number];
}

export interface VolumeArrayDescriptor {
  dtype: BinaryDType;
  endianness: 'little' | 'not-applicable';
  order: 'C';
}

export type VolumeValidityDescriptor =
  | {
      kind: 'sentinel';
      outsideValue: number;
    }
  | {
      kind: 'mask';
      mask: {
        resource: BinaryArrayDescriptor;
        shape: readonly [number, number, number];
      };
      codes: Readonly<{ valid: number; outside: number; missing: number }>;
    };

export interface VolumeRepresentationDescriptor {
  kind: 'volume';
  format: 'ephys-atlas-volume-v1';
  layout: 'chunks3d' | 'orthogonal_slice_packs';
  grid: VolumeGridDescriptor;
  array: VolumeArrayDescriptor;
  resource: Record<string, unknown>;
  resourceIndexPath: string;
  resourceIndexResource: EncodedResourceDescriptor;
  summaryPath: string;
  summaryResource: EncodedResourceDescriptor;
  validity: VolumeValidityDescriptor;
}

export interface FeatureDescriptor {
  id: string;
  path: string;
  label: string;
  description: string;
  unit: string | null;
  valueSemantics: FeatureValueSemantics;
  display: FeatureDisplay;
  artifacts: readonly ArtifactDescriptor[];
  statistics: readonly StatisticId[];
  representations: {
    regional?: RegionalRepresentationDescriptor;
    volume?: VolumeRepresentationDescriptor;
  };
}

export interface DatasetManifest {
  schemaVersion: SchemaVersion;
  dataset: {
    id: DatasetId;
    release: string;
    title: string;
    description: string;
    fixture?: boolean;
  };
  release: ReleaseMetadata;
  provenance: DatasetProvenance;
  artifacts: readonly ArtifactDescriptor[];
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

export interface DistributionCounts {
  binCounts: readonly number[];
  underflowCount: number;
  overflowCount: number;
}

export interface DistributionBinning {
  id: string;
  scale: ScaleSpec;
  domain: DistributionDomainSpec;
  edges: readonly number[];
  global: DistributionCounts;
  regional?: readonly DistributionCounts[];
  binRule: 'left-closed-right-open-last-closed';
}

export interface ScalarDistribution {
  binnings: readonly DistributionBinning[];
}

export interface VolumeValidStatistics {
  min: number | null;
  max: number | null;
  mean: number | null;
  std: number | null;
  median: number | null;
  q05: number | null;
  q25: number | null;
  q75: number | null;
  q95: number | null;
}

export interface VolumeFeatureSummary {
  totalVoxelCount: number;
  validVoxelCount: number;
  outsideVoxelCount: number;
  missingVoxelCount: number;
  validStatistics: VolumeValidStatistics;
  valueRange: readonly [number | null, number | null];
  distribution?: ScalarDistribution;
}

export type RegionalStatisticId = StatisticId | 'missing_count' | 'std' | 'q05' | 'q25' | 'q75' | 'q95';

export interface RegionalFeaturePayload {
  schemaVersion: SchemaVersion;
  featureId: string;
  representation: 'regional';
  parcellation: ParcellationId;
  regionIds: readonly string[];
  statistics: Partial<Record<RegionalStatisticId, readonly number[]>>;
  population?: string;
  global?: GlobalStatistics;
  distribution?: ScalarDistribution;
}

export interface VolumeFeaturePayload {
  schemaVersion: SchemaVersion;
  featureId: string;
  representation: 'volume';
  descriptor: VolumeRepresentationDescriptor;
  summary: VolumeFeatureSummary;
  loadResource(path: string, signal?: AbortSignal, resource?: EncodedResourceDescriptor): Promise<ArrayBuffer>;
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
    signal?: AbortSignal,
  ): Promise<FeaturePayload>;
  loadArtifact(
    ref: DatasetRef,
    artifactId: string,
    featureId?: string,
    signal?: AbortSignal,
  ): Promise<ArtifactPayload>;
  prefetchFeature?(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
    signal?: AbortSignal,
  ): Promise<void>;
}
