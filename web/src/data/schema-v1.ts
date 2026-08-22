/** Staged schema-v1 types for the atomic projection/volume cutover. */
export const SCHEMA_V1 = '1.0' as const;

export type SchemaV1Version = typeof SCHEMA_V1;
export type ReferenceSpaceId = string;
export type GridId = string;
export type OrthogonalProjectionId = 'coronal' | 'sagittal' | 'horizontal';
export type StaticProjectionId = 'top' | 'swanson';
export type ProjectionId = OrthogonalProjectionId | StaticProjectionId;
export type VolumeLayout = 'chunks3d' | 'orthogonal_slice_packs';

export interface ResourceCodecV1 {
  readonly name: 'none' | 'gzip';
  readonly decoded_bytes: number;
  readonly level?: number;
}

export interface EncodedResourceV1 {
  readonly path: string;
  readonly media_type: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly codec: ResourceCodecV1;
}

export interface DecodedResourceContractV1 {
  readonly format: string;
  readonly dtype?: BinaryDTypeV1;
  readonly shape?: readonly number[];
  readonly order?: 'C';
  readonly endianness?: 'little' | 'not-applicable';
  readonly storage_axes?: readonly string[];
  readonly layout?: VolumeLayout;
}

export type BinaryDTypeV1 =
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float16'
  | 'float32'
  | 'float64';

export interface BinaryArrayV1 {
  readonly format: 'raw-binary-array-v1';
  readonly resource: EncodedResourceV1;
  readonly dtype: BinaryDTypeV1;
  readonly shape: readonly number[];
  readonly order: 'C';
  readonly endianness: 'little' | 'not-applicable';
}

export interface VolumeGridV1 {
  readonly reference_space_id: ReferenceSpaceId;
  readonly grid_id: GridId;
  readonly world_axes: readonly ['ml', 'ap', 'dv'];
  readonly shape: readonly [number, number, number];
  readonly index_to_world_um: readonly number[];
  readonly world_to_index?: readonly number[];
  readonly voxel_edge_extent_um: readonly [number, number, number, number, number, number];
  readonly index_convention: 'integer-centers-half-integer-edges';
}

export type VolumeValidityV1 =
  | {
      readonly kind: 'sentinel';
      readonly outside_value: number;
      readonly missing_values: 'nonfinite';
      readonly classification_order: readonly ['outside', 'missing', 'valid'];
    }
  | {
      readonly kind: 'mask';
      readonly mask: BinaryArrayV1;
      readonly codes: Readonly<{ valid: number; outside: number; missing: number }>;
      readonly classification_order: readonly ['outside', 'missing', 'valid'];
    };

export interface VolumeRepresentationV1 {
  readonly format: 'ephys-atlas-volume-v1';
  readonly grid: VolumeGridV1;
  readonly array: Readonly<{ dtype: 'float16' | 'float32'; order: 'C'; endianness: 'little' }>;
  readonly validity: VolumeValidityV1;
  readonly summary: Readonly<{ format: 'ephys-atlas-volume-summary-v1'; resource: EncodedResourceV1 }>;
  readonly encoding: Readonly<{
    layout: VolumeLayout;
    resource_index: Readonly<{ format: 'ephys-atlas-volume-resource-index-v1'; resource: EncodedResourceV1 }>;
  }>;
}

export interface RegisteredProjectionV1 {
  readonly id: OrthogonalProjectionId;
  readonly kind: 'registered-slice-stack';
  readonly reference_space_id: ReferenceSpaceId;
  readonly grid_id: GridId;
  readonly world_slice_axis: 'ml' | 'ap' | 'dv';
  readonly slice_count: number;
  readonly slice_shape: readonly [number, number];
  readonly view_box: readonly [number, number, number, number];
  readonly plane_index_to_world_um: readonly number[];
  readonly world_to_plane_index?: readonly number[];
  readonly voxel_edge_extent_um: readonly [number, number, number, number, number, number];
  readonly display_slices: readonly number[];
  readonly resource_index: Readonly<{
    format: 'atlas-registered-svg-resource-index-v1';
    resource: EncodedResourceV1;
  }>;
}

export interface RegisteredSvgResourceIndexV1 {
  readonly schema_version: SchemaV1Version;
  readonly format: 'atlas-registered-svg-resource-index-v1';
  readonly projection_id: OrthogonalProjectionId;
  readonly resources: readonly Readonly<{
    pack_id: string;
    slice_indices: readonly number[];
    resource: EncodedResourceV1;
  }>[];
}

export interface StaticProjectionV1 {
  readonly id: StaticProjectionId;
  readonly kind: 'static-regional-map';
  readonly view_box: readonly [number, number, number, number];
  readonly path_count: number;
  readonly fragment: Readonly<{
    format: 'ibl-regional-svg-fragment-v1';
    encoding: 'utf-8';
    resource: EncodedResourceV1;
  }>;
}

export interface ProjectionPackV1 {
  readonly schema_version: SchemaV1Version;
  readonly format: 'atlas-projection-pack-v1';
  readonly pack_id: string;
  readonly immutable: true;
  readonly reference_space_id: ReferenceSpaceId;
  readonly mappings: readonly ['allen', 'beryl', 'cosmos'];
  readonly projections: readonly (RegisteredProjectionV1 | StaticProjectionV1)[];
  readonly provenance: Readonly<Record<string, unknown>>;
}

export type MeshHemisphereV1 = 'left' | 'right';
export type MeshMappingV1 = 'allen' | 'beryl' | 'cosmos';

export interface MeshDecoderV1 {
  readonly container: 'EAM3';
  readonly container_version: 1;
  readonly encoding: 'raw-v1' | 'meshopt-quantized-v1';
  readonly position_bits: number;
  readonly normal_bits: number;
}

export interface MeshRegionV1 {
  readonly feature_id: number;
  readonly source_allen_id: number;
  readonly signed_allen_id: number;
  readonly hemisphere: MeshHemisphereV1;
  readonly mappings: Readonly<Record<MeshMappingV1, number | null>>;
  readonly signed_explode_group_id: number;
}

export interface MeshLodV1 {
  readonly id: string;
  readonly triangle_count: number;
  readonly resource: EncodedResourceV1;
  readonly decoder: MeshDecoderV1;
}

export interface MeshPackV1 {
  readonly schema_version: SchemaV1Version;
  readonly format: 'atlas-mesh-pack-v1';
  readonly pack_id: string;
  readonly geometry_id: string;
  readonly immutable: true;
  readonly purpose: 'test-only' | 'production';
  readonly reference_space_id: ReferenceSpaceId;
  readonly regions: readonly MeshRegionV1[];
  readonly default_lod_id: string;
  readonly upgrade_lod_id: string | null;
  readonly lods: readonly MeshLodV1[];
  readonly [key: string]: unknown;
}

export function decodedResourceCacheKey(
  resource: EncodedResourceV1,
  contract: DecodedResourceContractV1,
): string {
  const identity = [
    contract.format,
    contract.dtype ?? null,
    contract.shape ?? null,
    contract.order ?? null,
    contract.endianness ?? null,
    contract.storage_axes ?? null,
    contract.layout ?? null,
  ];
  return `${resource.sha256}:${JSON.stringify(identity)}`;
}
