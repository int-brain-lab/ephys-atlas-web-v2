import { planeToWorld } from '../../core/spatial.js';
import {
  ANATOMY_AXES,
  type AnatomyPackManifest,
} from './types.js';
import {
  SHA256,
  finiteNumber,
  integer,
  parseProjection,
  record,
  safeRelativePath,
  string,
} from './manifest-projection.js';
import {
  parseProvenance,
  parseProvenancePin,
  parseSynchronizationSentinels,
  parseValidation,
} from './manifest-validation.js';

export * from './types.js';
export { nearestDisplaySlice } from './manifest-projection.js';

export function parseAnatomyPackManifest(value: unknown): AnatomyPackManifest {
  const root = record(value, 'anatomy manifest');
  const v1 = root.format === 'anatomy-pack-v1' && root.schema_version === '1.0';
  const v2 = root.format === 'anatomy-pack-v2' && root.schema_version === '2.0';
  const v3 = root.format === 'anatomy-pack-v3' && root.schema_version === '3.0';
  if (!v1 && !v2 && !v3) throw new Error('unsupported anatomy manifest format');
  const format = v3 ? 'anatomy-pack-v3' as const : v2 ? 'anatomy-pack-v2' as const : 'anatomy-pack-v1' as const;
  const schemaVersion = v3 ? '3.0' as const : v2 ? '2.0' as const : '1.0' as const;
  const resolutionUm = v1 ? 25 : 10;
  if (root.immutable !== true) throw new Error('anatomy manifest must be immutable');
  const packId = string(root.pack_id, 'pack_id');
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(packId)) throw new Error('pack_id is invalid');
  const createdAt = string(root.created_at, 'created_at');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('created_at must be an ISO date-time');
  const coordinateSystem = record(root.coordinate_system, 'coordinate_system');
  if (coordinateSystem.units !== 'um') throw new Error('coordinate_system.units must be um');
  if (coordinateSystem.matrix_order !== 'row-major') throw new Error('coordinate_system.matrix_order must be row-major');
  if (coordinateSystem.voxel_centers !== 'integer-indices' || coordinateSystem.voxel_edges !== 'half-integer-indices') {
    throw new Error('anatomy manifest must declare integer voxel centers and half-integer voxel edges');
  }
  if (JSON.stringify(coordinateSystem.world_axes) !== JSON.stringify(['ml', 'ap', 'dv'])) {
    throw new Error('coordinate_system.world_axes must be [ml, ap, dv]');
  }

  if (v3) {
    const parent = record(root.parent, 'parent');
    if (parent.format !== 'anatomy-pack-v2') throw new Error('v3 parent must be anatomy-pack-v2');
    const parentPackId = string(parent.pack_id, 'parent.pack_id');
    const parentDigest = string(parent.manifest_sha256, 'parent.manifest_sha256');
    if (!SHA256.test(parentDigest)) throw new Error('parent.manifest_sha256 must be a SHA-256 digest');
    if (parentPackId === packId) throw new Error('v3 parent and child pack IDs must differ');
    const source = record(parent.source, 'parent.source');
    if (source.atlas !== 'Allen CCFv3' || source.resolution_um !== 10 || source.hemisphere !== 'bilateral') {
      throw new Error('v3 parent source is not bilateral 10 um Allen CCFv3');
    }
    const ids = record(source.region_ids, 'parent.source.region_ids');
    if (ids.domain !== 'signed_allen_atlas_id' || ids.left_sign !== 'negative' || ids.right_sign !== 'positive' || ids.background_id !== 0) {
      throw new Error('parent.source.region_ids is invalid');
    }
    for (const key of ['annotation', 'region_lut'] as const) {
      const descriptor = record(source[key], `parent.source.${key}`);
      safeRelativePath(descriptor.path, `parent.source.${key}.path`);
      integer(descriptor.bytes, `parent.source.${key}.bytes`, 1);
      if (!SHA256.test(string(descriptor.sha256, `parent.source.${key}.sha256`))) throw new Error(`parent.source.${key}.sha256 is invalid`);
    }
    const rawProjections = record(root.projections, 'projections');
    const projections = {
      coronal: parseProjection(rawProjections.coronal, 'coronal', 10, true),
      sagittal: parseProjection(rawProjections.sagittal, 'sagittal', 10, true),
      horizontal: parseProjection(rawProjections.horizontal, 'horizontal', 10, true),
    };
    for (const axis of ANATOMY_AXES) {
      const projection = projections[axis];
      if (!projection.displaySliceIndices || projection.displaySliceIndices.length !== projection.displaySliceCount) {
        throw new Error(`projections.${axis} must declare display slices`);
      }
      const item = record(rawProjections[axis], `projections.${axis}`);
      if (item.lattice_spacing_um !== 80 || item.display_slice_count !== projection.displaySliceIndices.length) {
        throw new Error(`projections.${axis} has invalid 80 um display lattice`);
      }
      if (projection.displaySliceIndices.some((nativeIndex, ordinal) => ordinal > 0 && nativeIndex - projection.displaySliceIndices![ordinal - 1]! !== 8)) {
        throw new Error(`projections.${axis} display inventory is not spaced by 80 um`);
      }
      const anchorIndex = integer(item.lattice_anchor_slice_index, `projections.${axis}.lattice_anchor_slice_index`);
      const anchorWorld = finiteNumber(item.lattice_origin_um, `projections.${axis}.lattice_origin_um`);
      const expectedAnchorWorld = planeToWorld(projection.planeIndexToWorldUm, { slice: anchorIndex, u: 0, v: 0 })[projection.fixedWorldAxis];
      if (!projection.displaySliceIndices.includes(anchorIndex) || Math.abs(anchorWorld - expectedAnchorWorld) > 1e-6) {
        throw new Error(`projections.${axis} display lattice anchor is invalid`);
      }
      const packSet = projection.packSets['8'];
      if (!packSet) throw new Error(`projections.${axis} must provide depth-eight indexed packs`);
      for (const pack of packSet.packs) {
        const firstSlice = projection.displaySliceIndices[pack.firstDisplayIndex!];
        if (pack.packId !== `${packId}:${axis}:${pack.packIndex}` || pack.firstSliceIndex !== firstSlice) {
          throw new Error(`projections.${axis} pack identity or display range is invalid`);
        }
      }
    }
    const sampling = record(root.sampling, 'sampling');
    if (sampling.native_resolution_um !== 10 || sampling.spacing_um !== 80 || sampling.pack_depth !== 8) {
      throw new Error('v3 sampling must declare native 10 um, display 80 um, depth 8');
    }
    const parentProvenance = parseProvenance(parent.provenance);
    const childProvenance = record(root.provenance, 'provenance');
    parseProvenancePin(childProvenance.generator, 'provenance.generator', true);
    if (childProvenance.derivation !== 'byte-preserving SVG fragment extraction from validated parent anatomy-pack-v2') {
      throw new Error('v3 provenance derivation is invalid');
    }
    const parentValidation = parseValidation(parent.validation, projections, true);
    const validation = record(root.validation, 'validation');
    const nativeSlices = ANATOMY_AXES.reduce((sum, axis) => sum + projections[axis].sliceCount, 0);
    const displaySlices = ANATOMY_AXES.reduce((sum, axis) => sum + (projections[axis].displaySliceIndices?.length ?? 0), 0);
    if (validation.native_source_slices !== nativeSlices || validation.display_emitted_slices !== displaySlices) {
      throw new Error('v3 validation slice counts are invalid');
    }
    return {
      format,
      schemaVersion,
      packId,
      immutable: true,
      createdAt,
      source,
      coordinateSystem,
      projections,
      provenance: childProvenance,
      validation,
      synchronizationSentinels: parseSynchronizationSentinels(parent.synchronization_sentinels, projections),
      parent: { ...parent, provenance: parentProvenance, validation: parentValidation },
      sampling,
    };
  }

  const source = record(root.source, 'source');
  const hemisphere = v2 ? 'bilateral' : 'left';
  if (source.atlas !== 'Allen CCFv3' || source.resolution_um !== resolutionUm || source.hemisphere !== hemisphere) {
    throw new Error(`generated anatomy must be the ${resolutionUm} um ${hemisphere} Allen CCFv3 atlas`);
  }
  const ids = record(source.region_ids, 'source.region_ids');
  if (ids.domain !== 'signed_allen_atlas_id' || ids.left_sign !== 'negative' || ids.background_id !== 0) {
    throw new Error('source.region_ids must declare negative signed Allen IDs with background 0');
  }
  if (v2 && ids.right_sign !== 'positive') throw new Error('bilateral source.region_ids must declare positive right IDs');
  for (const key of ['annotation', 'region_lut'] as const) {
    const descriptor = record(source[key], `source.${key}`);
    safeRelativePath(descriptor.path, `source.${key}.path`);
    integer(descriptor.bytes, `source.${key}.bytes`, 1);
    const digest = string(descriptor.sha256, `source.${key}.sha256`);
    if (!SHA256.test(digest)) throw new Error(`source.${key}.sha256 must be 64 lowercase hexadecimal characters`);
  }
  const rawProjections = record(root.projections, 'projections');
  const projections = {
    coronal: parseProjection(rawProjections.coronal, 'coronal', resolutionUm),
    sagittal: parseProjection(rawProjections.sagittal, 'sagittal', resolutionUm),
    horizontal: parseProjection(rawProjections.horizontal, 'horizontal', resolutionUm),
  };
  const provenance = parseProvenance(root.provenance);
  const validation = parseValidation(root.validation, projections, v2);
  return {
    format,
    schemaVersion,
    packId,
    immutable: true,
    createdAt,
    source,
    coordinateSystem,
    projections,
    provenance,
    validation,
    synchronizationSentinels: parseSynchronizationSentinels(root.synchronization_sentinels, projections),
  };
}
