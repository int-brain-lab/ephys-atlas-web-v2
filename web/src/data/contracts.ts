import type { DatasetId, DatasetRef, ParcellationId, RepresentationKind, StatisticId } from '../domain/types.js';

export const SCHEMA_VERSION = '0.1' as const;
export type SchemaVersion = typeof SCHEMA_VERSION;
export type BinaryDType = 'int16' | 'int32' | 'uint16' | 'uint32' | 'float16' | 'float32' | 'float64';

export interface BinaryArrayDescriptor { path: string; dtype: BinaryDType; shape: readonly number[]; order: 'C'; endianness: 'little' | 'not-applicable'; sha256?: string; bytes?: number; }
export interface DatasetReleaseSummary { id: string; label: string; manifest: string; immutable: boolean; }
export interface DatasetCatalogEntry { id: DatasetId; title: string; description?: string; releases: readonly DatasetReleaseSummary[]; defaultRelease: string; }
export interface DatasetCatalog { schemaVersion: SchemaVersion; datasets: readonly DatasetCatalogEntry[]; }
export interface FeatureReference { id: string; path: string; }
export interface ParcellationDescriptor { id: ParcellationId; regionIndex: BinaryArrayDescriptor; metadata?: string; }
export interface ReleasePublication { doi?: string; label?: string; }
export interface ReleaseMetadata { releaseId: string; immutable: true; createdAt: string; paperSnapshot: boolean; publication?: ReleasePublication; }
export type ProvenanceSourceRole = 'scientific-code' | 'canonical-data' | 'selection-freeze' | 'publication-input' | 'user-input';
export interface ProvenanceSource { role: ProvenanceSourceRole; description: string; repository?: string; commit?: string; path?: string; release?: string; uri?: string; sha256?: string; }
export interface ProvenanceBuilder { name: string; version: string; command: string; repository?: string; commit?: string; }
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface DatasetProvenance { sources: readonly ProvenanceSource[]; builder: ProvenanceBuilder; recipe: Readonly<Record<string, JsonValue>> & { readonly id: string }; notes: readonly string[]; }
export interface RegionMetadata { id: string; atlasId: number; index: number; acronym: string; name: string; parentId?: string | null; depth?: number; colorHex?: string; mappingMember?: boolean; legacyIndex?: number; }
export interface DatasetManifestDocument { schemaVersion: SchemaVersion; datasetId: string; title: string; description: string; release: ReleaseMetadata; provenance: DatasetProvenance; parcellations: readonly ParcellationDescriptor[]; featureRefs: readonly FeatureReference[]; }
export interface FeatureValueSemantics { quantity: string; transform: string; sourcePopulation: string; missingValues: string; sourceColumn?: string; qcFilter?: string; }
export interface RegionalParcellationDescriptor { parcellationId: ParcellationId; summary: string; values: BinaryArrayDescriptor; statistics: string; }
export interface RegionalRepresentationDescriptor { kind: 'regional'; format: 'ephys-atlas-regional-v0.1'; parcellations: Partial<Record<ParcellationId, RegionalParcellationDescriptor>>; }
export interface VolumeGridDescriptor { shape: readonly [number, number, number]; axisOrder: readonly [string, string, string]; coordinateSystem: string; voxelSizeUm: readonly [number, number, number]; originUm: readonly [number, number, number]; indexToWorldUm: readonly number[]; }
export interface VolumeArrayDescriptor { dtype: BinaryDType; endianness: 'little' | 'not-applicable'; order: 'C'; nonfinite: 'preserve' | 'forbid'; }
export interface VolumeRepresentationDescriptor { kind: 'volume'; format: 'ephys-atlas-chunked-volume-v0.1'; layout: 'chunks3d' | 'orthogonal_slice_packs'; grid: VolumeGridDescriptor; array: VolumeArrayDescriptor; resource: Record<string, unknown>; statistics?: string; valueRange?: readonly [number | null, number | null]; }
export interface FeatureDescriptor { id: string; path: string; label: string; description: string; unit: string | null; valueSemantics: FeatureValueSemantics; statistics: readonly StatisticId[]; representations: { regional?: RegionalRepresentationDescriptor; volume?: VolumeRepresentationDescriptor; }; }
export interface DatasetManifest { schemaVersion: SchemaVersion; dataset: { id: DatasetId; release: string; title: string; description: string; fixture?: boolean; }; release: ReleaseMetadata; provenance: DatasetProvenance; parcellations: readonly ParcellationId[]; parcellationDescriptors: Partial<Record<ParcellationId, ParcellationDescriptor>>; features: readonly FeatureDescriptor[]; }
export interface GlobalStatistics { count?: number; missingCount?: number; min?: number; max?: number; mean?: number; std?: number; median?: number; q05?: number; q25?: number; q75?: number; q95?: number; }
export interface RegionalHistogram { edges: readonly number[]; globalCounts: readonly number[]; regionalCounts?: readonly (readonly number[])[]; binRule?: string; }
export interface RegionalFeaturePayload { schemaVersion: SchemaVersion; featureId: string; representation: 'regional'; parcellation: ParcellationId; regionIds: readonly string[]; statistics: Partial<Record<StatisticId, readonly number[]>>; population?: string; global?: GlobalStatistics; histogram?: RegionalHistogram; }
export interface VolumeFeaturePayload { schemaVersion: SchemaVersion; featureId: string; representation: 'volume'; descriptor: VolumeRepresentationDescriptor; loadResource(path: string, signal?: AbortSignal): Promise<ArrayBuffer>; baseUrl?: string; }
export type FeaturePayload = RegionalFeaturePayload | VolumeFeaturePayload;
export interface DatasetSource { readonly kind: 'published' | 'local'; loadCatalog(): Promise<DatasetCatalog>; loadManifest(ref: DatasetRef): Promise<DatasetManifest>; loadRegions(ref: DatasetRef, parcellation: ParcellationId): Promise<readonly RegionMetadata[]>; loadFeature(ref: DatasetRef, featureId: string, representation: RepresentationKind, parcellation?: ParcellationId): Promise<FeaturePayload>; prefetchFeature?(ref: DatasetRef, featureId: string, representation: RepresentationKind, parcellation?: ParcellationId): Promise<void>; }
