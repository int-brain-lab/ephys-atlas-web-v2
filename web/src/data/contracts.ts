import type {
  DatasetId,
  DatasetRef,
  ParcellationId,
  RepresentationKind,
  StatisticId,
} from '../domain/types.js';

/**
 * Provisional frontend boundary while work/data-schema is being designed.
 * Keep this small and replace it with generated/shared schema types once available.
 */
export const PROVISIONAL_SCHEMA_VERSION = '0.1-provisional' as const;
export type ProvisionalSchemaVersion = typeof PROVISIONAL_SCHEMA_VERSION;

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

export interface DatasetCatalog {
  schemaVersion: ProvisionalSchemaVersion;
  datasets: readonly DatasetCatalogEntry[];
}

export interface RegionalRepresentationDescriptor {
  kind: 'regional';
  format: 'json';
  parcellations: Partial<Record<ParcellationId, string>>;
}

export interface VolumeRepresentationDescriptor {
  kind: 'volume';
  format: 'json';
  resource: string;
}

export interface FeatureDescriptor {
  id: string;
  label: string;
  description?: string;
  unit?: string;
  statistics: readonly StatisticId[];
  representations: {
    regional?: RegionalRepresentationDescriptor;
    volume?: VolumeRepresentationDescriptor;
  };
}

export interface DatasetManifest {
  schemaVersion: ProvisionalSchemaVersion;
  dataset: {
    id: DatasetId;
    release: string;
    title: string;
    description?: string;
    fixture?: boolean;
  };
  parcellations: readonly ParcellationId[];
  features: readonly FeatureDescriptor[];
}

export interface RegionalFeaturePayload {
  schemaVersion: ProvisionalSchemaVersion;
  featureId: string;
  representation: 'regional';
  parcellation: ParcellationId;
  regionIds: readonly string[];
  statistics: Partial<Record<StatisticId, readonly number[]>>;
}

export interface VolumeFeaturePayload {
  schemaVersion: ProvisionalSchemaVersion;
  featureId: string;
  representation: 'volume';
  shape: readonly [number, number, number];
  dtype: string;
  data: string;
}

export type FeaturePayload = RegionalFeaturePayload | VolumeFeaturePayload;

export interface DatasetSource {
  readonly kind: 'published' | 'local';
  loadCatalog(): Promise<DatasetCatalog>;
  loadManifest(ref: DatasetRef): Promise<DatasetManifest>;
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
