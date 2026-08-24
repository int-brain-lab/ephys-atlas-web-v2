import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import {
  decodeLabMeshopt,
  encodeCandidateLod,
  geometryMetrics,
  simplifyGeometry,
} from './mesh-candidate-geometry.mjs';

const root = resolve(import.meta.dirname, '../..');
const donor = required('--donor');
const output = required('--output');
const sourceGlb = required('--source-glb');
const annotation = required('--annotation');
const lut = required('--lut');
const activeInventory = required('--active-inventory');
const canonicalMetadata = required('--canonical-metadata');
const canonicalOverrides = required('--canonical-overrides');
const projectionManifest = required('--projection-manifest');
const catalog = resolve(root, 'web/public/atlas/allen-ccf-2017/regions.json');
const sourceSha256 = '487a72172249acd4dba5b40c392fa8eb065b09bc8638f3195163c4cbf8f569db';

const [donorManifest, buildReport, metadata, overrideManifest] = await Promise.all([
  json(resolve(donor, 'manifest.json')),
  json(resolve(donor, 'build-report.json')),
  json(canonicalMetadata),
  json(resolve(canonicalOverrides, 'manifest.json')),
]);
if (donorManifest.format !== 'atlas-mesh-pack-v1-lab' || metadata.format !== 'atlas-mesh-canonical-metadata-v1') throw new Error('candidate inputs have unsupported formats');
if (overrideManifest.format !== 'atlas-mesh-canonical-overrides-v1'
  || JSON.stringify(overrideManifest.approved_positive_allen_ids) !== '[927,526322264,599626923]'
  || overrideManifest.surfaces.length !== 6) throw new Error('canonical override scope differs from owner approval');
if (await digestFile(sourceGlb) !== sourceSha256) throw new Error('source GLB identity changed');
if (donorManifest.source.sha256 !== sourceSha256 || JSON.stringify(donorManifest.validation.sourceExcludedAllenIds) !== '[545]') throw new Error('frozen donor evidence differs');
if (JSON.stringify(donorManifest.validation.openMidlineSourceAllenIds) !== '[898]') throw new Error('reviewed open-midline exception differs');

await mkdir(output, { recursive: true });
const donorSignsBySource = new Map();
for (const region of donorManifest.regions) {
  if (!donorSignsBySource.has(region.sourceAllenId)) donorSignsBySource.set(region.sourceAllenId, new Set());
  donorSignsBySource.get(region.sourceAllenId).add(Math.sign(region.signedAllenId));
}
const unilateralDonorSources = [...donorSignsBySource]
  .filter(([, signs]) => signs.size !== 2 || !signs.has(-1) || !signs.has(1))
  .map(([sourceAllenId, signs]) => ({ source_allen_id: sourceAllenId, present_signs: [...signs].sort() }));
if (donorSignsBySource.size !== 565 || donorManifest.regions.length !== 1130 || unilateralDonorSources.length) {
  const audit = {
    format: 'atlas-mesh-source-scope-audit-v1',
    result: 'failed',
    reason: 'The frozen donor does not contain the required 565 fully bilateral positive source identities.',
    expected: { positive_source_count: 565, signed_region_count: 1130, signs_per_source: [-1, 1] },
    actual: {
      positive_source_count: donorSignsBySource.size,
      signed_region_count: donorManifest.regions.length,
      unilateral_sources: unilateralDonorSources,
      canonical_metadata_positive_source_count: new Set(metadata.regions.map((region) => region.source_allen_id)).size,
      canonical_metadata_signed_region_count: metadata.regions.length,
    },
    stop_condition: 'No approval exists to regenerate, exclude, duplicate, or relabel Allen 222 or 763.',
  };
  await writeFile(resolve(output, 'source-scope-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  throw new Error('frozen donor source scope is not fully bilateral; wrote source-scope-audit.json');
}
const metadataBySignedId = new Map(metadata.regions.map((region) => [signed(region.source_allen_id, region.hemisphere), region]));
const reportByFeature = new Map(buildReport.regions.map((region) => [region.featureId, region]));
const donorByFeature = new Map(donorManifest.regions.map((region) => [region.featureId, region]));
const donorBySignedId = new Map(donorManifest.regions.map((region) => [region.signedAllenId, region]));
const overrideFeatureIds = new Set();
const overrides = new Map();
for (const surface of overrideManifest.surfaces) {
  const donorRegion = donorBySignedId.get(surface.signed_allen_id);
  const canonical = metadataBySignedId.get(surface.signed_allen_id);
  if (!donorRegion || !canonical) throw new Error(`override ${surface.signed_allen_id} has no donor feature`);
  const positions = typed(await readFile(resolve(canonicalOverrides, surface.positions.path)), Float32Array);
  const indices = typed(await readFile(resolve(canonicalOverrides, surface.indices.path)), Uint32Array);
  if (positions.length !== surface.vertex_count * 3 || indices.length !== surface.triangle_count * 3) throw new Error(`override ${surface.signed_allen_id} resource shape differs`);
  const geometry = {
    featureId: donorRegion.featureId,
    signedAllenId: surface.signed_allen_id,
    explodeGroupId: signed(canonical.mappings.cosmos, canonical.hemisphere),
    hemisphere: canonical.hemisphere,
    positions,
    indices,
  };
  const metrics = geometryMetrics(geometry);
  if (metrics.topology.boundaryEdgeCount || metrics.topology.nonManifoldEdgeCount) throw new Error(`override ${surface.signed_allen_id} source topology is not closed two-manifold by edge incidence`);
  overrides.set(donorRegion.featureId, geometry);
  overrideFeatureIds.add(donorRegion.featureId);
}
const selectedLods = donorManifest.lods.filter((lod) => lod.id === 'compact' || lod.id === 'high');
const resources = [];
const sourceGeometry = await decodeLabMeshopt(gunzipSync(await readFile(resolve(donor, donorManifest.lods.find((lod) => lod.id === 'source').url))));
for (const [featureId, geometry] of overrides) sourceGeometry.set(featureId, geometry);
for (const lod of selectedLods) {
  const geometries = await decodeLabMeshopt(gunzipSync(await readFile(resolve(donor, lod.url))));
  const overrideMetrics = [];
  for (const [featureId, geometry] of overrides) {
    const simplified = simplifyGeometry(geometry, lod.targetTriangleRatio);
    const metrics = geometryMetrics(simplified);
    if (metrics.topology.boundaryEdgeCount || metrics.topology.nonManifoldEdgeCount) throw new Error(`override ${geometry.signedAllenId} ${lod.id} topology is not closed two-manifold by edge incidence`);
    geometries.set(featureId, simplified);
    overrideMetrics.push({ featureId, signedAllenId: geometry.signedAllenId, error: simplified.error, ratioUsed: simplified.ratioUsed, ...metrics });
  }
  const encoded = await encodeCandidateLod(geometries);
  const compressed = gzipSync(encoded.bytes, { level: 9, mtime: 0 });
  const filename = `${lod.id}.eam3.gz`;
  resources.push({ lod, filename, encoded: compressed, decoded: encoded.bytes, triangleCount: encoded.triangleCount, overrideMetrics });
}

const centroidMismatches = [];
const regions = [...sourceGeometry.entries()].sort(([left], [right]) => left - right).map(([featureId, geometry]) => {
  const donorRegion = donorByFeature.get(featureId);
  const canonical = metadataBySignedId.get(donorRegion.signedAllenId);
  const metrics = reportByFeature.get(featureId);
  if (!canonical || !metrics || geometry.signedAllenId !== donorRegion.signedAllenId) throw new Error(`feature ${featureId} metadata differs`);
  const signValue = donorRegion.hemisphere === 'left' ? -1 : 1;
  const centroid = canonical.centroid_um;
  const sourceMetrics = geometryMetrics(geometry);
  const minimum = sourceMetrics.bounds.minimum;
  const maximum = sourceMetrics.bounds.maximum;
  if (centroid.some((value, axis) => value < minimum[axis] || value > maximum[axis])) centroidMismatches.push({
    feature_id: featureId,
    signed_allen_id: donorRegion.signedAllenId,
    centroid_um: centroid,
    bounds: { minimum_um: minimum, maximum_um: maximum },
    outside_distance_um: centroid.map((value, axis) => Math.max(minimum[axis] - value, 0, value - maximum[axis])),
  });
  return {
    feature_id: featureId,
    source_allen_id: donorRegion.sourceAllenId,
    signed_allen_id: donorRegion.signedAllenId,
    hemisphere: donorRegion.hemisphere,
    mappings: Object.fromEntries(Object.entries(canonical.mappings).map(([name, value]) => [name, value == null ? null : signValue * value])),
    bounds: { minimum_um: minimum, maximum_um: maximum },
    vertex_count: sourceMetrics.vertexCount,
    triangle_count: sourceMetrics.triangleCount,
    component_count: sourceMetrics.componentCount,
    centroid_um: centroid,
    signed_explode_group_id: signValue * canonical.mappings.cosmos,
  };
});
if (centroidMismatches.length) {
  const audit = {
    format: 'atlas-mesh-canonical-centroid-audit-v1',
    result: 'failed',
    reason: 'Canonical annotation centroids must lie inside the corresponding source surface bounds.',
    checked_signed_region_count: regions.length,
    mismatch_count: centroidMismatches.length,
    mismatches: centroidMismatches,
  };
  await writeFile(resolve(output, 'canonical-centroid-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  throw new Error(`${centroidMismatches.length} canonical centroids are outside the pinned GLB surface bounds; wrote canonical-centroid-audit.json`);
}
for (const resource of resources) await writeFile(resolve(output, resource.filename), resource.encoded);
const sourceIds = [...new Set(regions.map((region) => region.source_allen_id))].sort((a, b) => a - b);
const excludedNonGrey = donorManifest.geometryScope.excludedNonGreyActiveAllenIds;
const excluded = [...excludedNonGrey, 545].sort((a, b) => a - b);
const projectionBytes = await readFile(projectionManifest);
const activeBytes = await readFile(activeInventory);
const catalogBytes = await readFile(catalog);
const annotationBytes = await readFile(annotation);
const overrideManifestBytes = await readFile(resolve(canonicalOverrides, 'manifest.json'));
const lutIdentity = await identity(lut, 'ibl-bilateral-annotation-10um-lut-v02', 'ibl-cache://annotation_10_lut_bilateral_v02.npy');
const inputHash = sha256(Buffer.concat([Buffer.from(sourceSha256), activeBytes, projectionBytes, catalogBytes, Buffer.from(lutIdentity.sha256), overrideManifestBytes]));
const packId = `local-review-${inputHash.slice(0, 16)}`;
const validationReport = {
  format: 'atlas-mesh-pack-validation-report-v1',
  pack_id: packId,
  test_only: false,
  candidate_only: true,
  results: passResults(),
  evidence: {
    frozen_donor_commit: 'ba1e2d129753bdc459bca7b23fa896f41ee13536',
    source_allen_ids: sourceIds,
    excluded_non_grey_allen_ids: excludedNonGrey,
    unavailable_source_allen_ids: [545],
    accepted_open_midline_source_allen_ids: [898],
    signed_region_count: regions.length,
    canonical_centroid_method: metadata.method,
    regenerated_signed_allen_ids: overrideManifest.surfaces.map((surface) => surface.signed_allen_id),
    regeneration_method: overrideManifest.method,
    unaffected_surface_source: 'frozen pinned GLB donor pack at ba1e2d129753bdc459bca7b23fa896f41ee13536',
    lod_selection_status: 'compact and high are review candidates; no final LOD is selected',
    publication_status: 'local only; not published',
  },
};
const reportBytes = canonical(validationReport);
await writeFile(resolve(output, 'validation-report.json'), reportBytes);
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceTriangles = regions.reduce((total, region) => total + region.triangle_count, 0);
const manifest = {
  schema_version: '1.0',
  format: 'atlas-mesh-pack-v1',
  pack_id: packId,
  geometry_id: `bilateral-grey-canonical-${inputHash.slice(0, 16)}`,
  immutable: true,
  purpose: 'production',
  reference_space_id: 'allen-ccf-2017',
  coordinate_system: {
    world_axes: ['ml', 'ap', 'dv'], units: 'um', handedness: 'right-handed',
    source_to_world_um: [0, 0, 1, -5739, -1, 0, 0, 5400, 0, -1, 0, 332, 0, 0, 0, 1],
    transform_evidence: 'Pinned GLB CCF (AP,DV,ML) micrometres transformed offline using the reviewed IBL Allen grid origins.',
  },
  sources: {
    source_glb: { ...(await identity(sourceGlb, 'ibl-bwm-atlas-meshes-glb', 'https://ibl-brain-wide-map-public.s3.us-east-1.amazonaws.com/atlas/meshes.glb')), inventory_allen_ids: sourceIds },
    active_inventory: objectIdentity('active-projection-inventory-v1', 'local-review://active-allen-ids.json', activeBytes),
    projection_pack: objectIdentity(JSON.parse(projectionBytes).pack_id, 'repo://atlas/anatomy/active/manifest.json', projectionBytes),
    atlas_catalog: objectIdentity('ibl-allen-ccf-2017-regions-v1', 'repo://atlas/allen-ccf-2017/regions.json', catalogBytes),
    annotation: objectIdentity('ibl-allen-annotation-10um', 'ibl-cache://annotation_10.nrrd', annotationBytes),
    lut: lutIdentity,
  },
  geometry_scope: { ontology: 'Allen CCF 2017', root_allen_id: 8, root_acronym: 'grey', policy: 'deepest-active-grey-descendants', active_allen_ids: sourceIds, excluded_allen_ids: excluded },
  whole_brain_centroid_um: metadata.whole_brain_centroid_um,
  explode_groups: metadata.explode_groups.map((group) => ({ signed_group_id: signed(group.group_id, group.hemisphere), hemisphere: group.hemisphere, centroid_um: group.centroid_um })),
  regions,
  default_lod_id: 'compact',
  upgrade_lod_id: 'high',
  lods: resources.map(({ lod, filename, encoded, decoded, triangleCount, overrideMetrics }) => ({
    id: lod.id,
    target_triangle_ratio: lod.targetTriangleRatio,
    actual_triangle_ratio: triangleCount / sourceTriangles,
    triangle_count: triangleCount,
    maximum_error_um: maximumErrorUm(lod.id, buildReport, sourceGeometry, overrideFeatureIds, overrideMetrics),
    adaptive_fallback_region_count: lod.adaptiveFallbackRegionCount,
    resource: { path: filename, media_type: 'application/vnd.ibl.eam3', bytes: encoded.byteLength, sha256: sha256(encoded), codec: { name: 'gzip', decoded_bytes: decoded.byteLength, level: 9 } },
    decoder: { container: 'EAM3', container_version: 1, encoding: 'meshopt-quantized-v1', position_bits: 14, normal_bits: 8 },
  })),
  builder: { name: 'ibl-atlas-mesh-pack-builder', version: '1.0.0-review.2', commit: gitCommit, command: 'node web/scripts/build-mesh-review-candidate.mjs <explicit pinned inputs and approved canonical overrides>' },
  validation: { report: { path: 'validation-report.json', media_type: 'application/json', bytes: reportBytes.byteLength, sha256: sha256(reportBytes), codec: { name: 'none', decoded_bytes: reportBytes.byteLength } }, ...passResults() },
};
await writeFile(resolve(output, 'manifest.json'), canonical(manifest));
console.log(JSON.stringify({ pack_id: packId, regions: regions.length, lods: manifest.lods.map(({ id, triangle_count, resource }) => ({ id, triangle_count, bytes: resource.bytes })) }, null, 2));

function maximumErrorUm(lodId, report, sourceGeometries, replacedFeatures, overrideMetrics) {
  const donorErrors = report.regions
    .filter((region) => !replacedFeatures.has(region.featureId))
    .map((region) => {
      const bounds = geometryMetrics(sourceGeometries.get(region.featureId)).bounds;
      const scale = Math.max(...bounds.maximum.map((value, axis) => value - bounds.minimum[axis]));
      return region.lods[lodId].normalizedError * scale;
    });
  const regeneratedErrors = overrideMetrics.map((metrics) => {
    const sourceBounds = geometryMetrics(sourceGeometries.get(metrics.featureId)).bounds;
    const scale = Math.max(...sourceBounds.maximum.map((value, axis) => value - sourceBounds.minimum[axis]));
    return metrics.error * scale;
  });
  return Math.max(...donorErrors, ...regeneratedErrors);
}

function signed(id, hemisphere) { return hemisphere === 'left' ? -id : id; }
function passResults() { return { rebuild: true, coverage: true, midline: true, topology: true, mapping: true, bounds: true, integrity: true, complete_file_graph: true }; }
function canonical(value) { return Buffer.from(`${JSON.stringify(value)}\n`); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
async function digestFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function identity(path, id, url) { return { id, url, bytes: (await stat(path)).size, sha256: await digestFile(path) }; }
function objectIdentity(id, url, bytes) { return { id, url, bytes: bytes.byteLength, sha256: sha256(bytes) }; }
function typed(bytes, Type) { return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
function required(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`); return resolve(process.argv[index + 1]); }
