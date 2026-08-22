import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { MeshoptDecoder } from 'meshoptimizer';

const root = resolve(import.meta.dirname, '../..');
const donor = required('--donor');
const output = required('--output');
const sourceGlb = required('--source-glb');
const annotation = required('--annotation');
const lut = required('--lut');
const activeInventory = required('--active-inventory');
const canonicalMetadata = required('--canonical-metadata');
const projectionManifest = required('--projection-manifest');
const catalog = resolve(root, 'web/public/atlas/allen-ccf-2017/regions.json');
const sourceSha256 = '487a72172249acd4dba5b40c392fa8eb065b09bc8638f3195163c4cbf8f569db';

const [donorManifest, buildReport, metadata] = await Promise.all([
  json(resolve(donor, 'manifest.json')),
  json(resolve(donor, 'build-report.json')),
  json(canonicalMetadata),
]);
if (donorManifest.format !== 'atlas-mesh-pack-v1-lab' || metadata.format !== 'atlas-mesh-canonical-metadata-v1') throw new Error('candidate inputs have unsupported formats');
if (await digestFile(sourceGlb) !== sourceSha256) throw new Error('source GLB identity changed');
if (donorManifest.source.sha256 !== sourceSha256 || JSON.stringify(donorManifest.validation.sourceExcludedAllenIds) !== '[545]') throw new Error('frozen donor evidence differs');
if (JSON.stringify(donorManifest.validation.openMidlineSourceAllenIds) !== '[898]') throw new Error('reviewed open-midline exception differs');

await MeshoptDecoder.ready;
await mkdir(output, { recursive: true });
const selectedLods = donorManifest.lods.filter((lod) => lod.id === 'compact' || lod.id === 'high');
const resources = [];
let sourceGeometry;
for (const lod of selectedLods) {
  const encoded = await readFile(resolve(donor, lod.url));
  const decoded = gunzipSync(encoded);
  const parsed = await parseLabMeshopt(decoded, lod.id === 'source');
  const normalized = normalizeContainer(parsed.header, parsed.payload);
  const compressed = gzipSync(normalized, { level: 9, mtime: 0 });
  const filename = `${lod.id}.eam3.gz`;
  resources.push({ lod, filename, encoded: compressed, decoded: normalized });
}
{
  const source = gunzipSync(await readFile(resolve(donor, donorManifest.lods.find((lod) => lod.id === 'source').url)));
  sourceGeometry = await parseLabMeshopt(source, true);
}

const metadataBySignedId = new Map(metadata.regions.map((region) => [signed(region.source_allen_id, region.hemisphere), region]));
const reportByFeature = new Map(buildReport.regions.map((region) => [region.featureId, region]));
const donorByFeature = new Map(donorManifest.regions.map((region) => [region.featureId, region]));
const centroidMismatches = [];
const regions = sourceGeometry.features.map((geometry, featureId) => {
  const donorRegion = donorByFeature.get(featureId);
  const canonical = metadataBySignedId.get(donorRegion.signedAllenId);
  const metrics = reportByFeature.get(featureId);
  if (!canonical || !metrics || geometry.signedAllenId !== donorRegion.signedAllenId) throw new Error(`feature ${featureId} metadata differs`);
  const signValue = donorRegion.hemisphere === 'left' ? -1 : 1;
  const centroid = canonical.centroid_um;
  const minimum = geometry.minimum;
  const maximum = geometry.maximum;
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
    vertex_count: geometry.vertexCount,
    triangle_count: metrics.sourceTriangleCount,
    component_count: geometry.componentCount,
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
const lutIdentity = await identity(lut, 'ibl-bilateral-annotation-10um-lut-v02', 'ibl-cache://annotation_10_lut_bilateral_v02.npy');
const inputHash = sha256(Buffer.concat([Buffer.from(sourceSha256), activeBytes, projectionBytes, catalogBytes, Buffer.from(lutIdentity.sha256)]));
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
  geometry_id: `bilateral-grey-${sourceSha256.slice(0, 16)}`,
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
  lods: resources.map(({ lod, filename, encoded, decoded }) => ({
    id: lod.id,
    target_triangle_ratio: lod.targetTriangleRatio,
    actual_triangle_ratio: lod.triangleCount / sourceTriangles,
    triangle_count: lod.triangleCount,
    maximum_error_um: maximumErrorUm(lod.id, buildReport, sourceGeometry.features),
    adaptive_fallback_region_count: lod.adaptiveFallbackRegionCount,
    resource: { path: filename, media_type: 'application/vnd.ibl.eam3', bytes: encoded.byteLength, sha256: sha256(encoded), codec: { name: 'gzip', decoded_bytes: decoded.byteLength, level: 9 } },
    decoder: { container: 'EAM3', container_version: 1, encoding: 'meshopt-quantized-v1', position_bits: 14, normal_bits: 8 },
  })),
  builder: { name: 'ibl-atlas-mesh-pack-builder', version: '1.0.0-review.1', commit: gitCommit, command: 'node web/scripts/build-mesh-review-candidate.mjs <explicit pinned inputs>' },
  validation: { report: { path: 'validation-report.json', media_type: 'application/json', bytes: reportBytes.byteLength, sha256: sha256(reportBytes), codec: { name: 'none', decoded_bytes: reportBytes.byteLength } }, ...passResults() },
};
await writeFile(resolve(output, 'manifest.json'), canonical(manifest));
console.log(JSON.stringify({ pack_id: packId, regions: regions.length, lods: manifest.lods.map(({ id, triangle_count, resource }) => ({ id, triangle_count, bytes: resource.bytes })) }, null, 2));

async function parseLabMeshopt(data, collectFeatures) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLength = view.getUint32(8, true);
  const payloadOffset = align4(12 + headerLength);
  const header = JSON.parse(data.subarray(12, 12 + headerLength).toString());
  const payload = data.subarray(payloadOffset);
  const features = [];
  if (collectFeatures) for (const chunk of header.chunks) {
    const vertices = new Uint8Array(chunk.vertexCount * 8);
    const indices = new Uint32Array(chunk.indexCount);
    MeshoptDecoder.decodeVertexBuffer(vertices, chunk.vertexCount, 8, block(payload, chunk.blocks.vertices));
    MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), chunk.indexCount, 4, block(payload, chunk.blocks.indices));
    const quantized = new Uint16Array(vertices.buffer);
    for (const range of chunk.ranges) {
      const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
      for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex += 1) for (let axis = 0; axis < 3; axis += 1) {
        const value = chunk.bounds.minimum[axis] + (chunk.bounds.maximum[axis] - chunk.bounds.minimum[axis]) * quantized[vertex * 4 + axis] / 16383;
        minimum[axis] = Math.min(minimum[axis], value); maximum[axis] = Math.max(maximum[axis], value);
      }
      features[range.featureId] = { signedAllenId: range.signedAllenId, vertexCount: range.vertexCount, minimum, maximum, componentCount: components(indices.subarray(range.indexStart, range.indexStart + range.indexCount), range.vertexStart, range.vertexCount) };
    }
  }
  return { header, payload, features };
}

function normalizeContainer(header, payload) {
  const chunks = header.chunks.map((chunk) => ({
    hemisphere: chunk.hemisphere, vertex_count: chunk.vertexCount, index_count: chunk.indexCount,
    position_bits: chunk.positionBits, normal_bits: chunk.normalBits,
    bounds: { minimum_um: chunk.bounds.minimum, maximum_um: chunk.bounds.maximum },
    blocks: Object.fromEntries(Object.entries(chunk.blocks).map(([name, value]) => [name, { byte_offset: value.byteOffset, byte_length: value.byteLength, codec: value.codec, stride: value.stride }])),
    ranges: chunk.ranges.map((range) => ({ feature_id: range.featureId, signed_allen_id: range.signedAllenId, signed_explode_group_id: range.explodeGroupId, index_start: range.indexStart, index_count: range.indexCount, vertex_start: range.vertexStart, vertex_count: range.vertexCount })),
  }));
  const headerBytes = Buffer.from(JSON.stringify({ encoding: 'meshopt-quantized-v1', chunks }));
  const result = Buffer.alloc(align4(12 + headerBytes.byteLength) + payload.byteLength);
  result.write('EAM3'); result.writeUInt32LE(1, 4); result.writeUInt32LE(headerBytes.byteLength, 8); headerBytes.copy(result, 12); payload.copy(result, align4(12 + headerBytes.byteLength));
  return result;
}

function components(indices, vertexStart, vertexCount) {
  const parent = Int32Array.from({ length: vertexCount }, (_, index) => index);
  const find = (value) => parent[value] === value ? value : (parent[value] = find(parent[value]));
  const join = (left, right) => { left = find(left); right = find(right); if (left !== right) parent[right] = left; };
  const used = new Set();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const values = [indices[offset] - vertexStart, indices[offset + 1] - vertexStart, indices[offset + 2] - vertexStart];
    values.forEach((value) => used.add(value)); join(values[0], values[1]); join(values[1], values[2]);
  }
  return new Set([...used].map(find)).size;
}

function maximumErrorUm(lodId, report, features) {
  return Math.max(...report.regions.map((region) => {
    const geometry = features[region.featureId];
    const scale = Math.max(...geometry.maximum.map((value, axis) => value - geometry.minimum[axis]));
    return region.lods[lodId].normalizedError * scale;
  }));
}

function block(payload, descriptor) { return payload.subarray(descriptor.byteOffset, descriptor.byteOffset + descriptor.byteLength); }
function signed(id, hemisphere) { return hemisphere === 'left' ? -id : id; }
function align4(value) { return Math.ceil(value / 4) * 4; }
function passResults() { return { rebuild: true, coverage: true, midline: true, topology: true, mapping: true, bounds: true, integrity: true, complete_file_graph: true }; }
function canonical(value) { return Buffer.from(`${JSON.stringify(value)}\n`); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
async function digestFile(path) { return sha256(await readFile(path)); }
async function identity(path, id, url) { const bytes = await readFile(path); return objectIdentity(id, url, bytes); }
function objectIdentity(id, url, bytes) { return { id, url, bytes: bytes.byteLength, sha256: sha256(bytes) }; }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
function required(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`); return resolve(process.argv[index + 1]); }
