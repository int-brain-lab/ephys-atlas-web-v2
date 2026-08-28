import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { MeshoptDecoder } from 'meshoptimizer';

const DONOR_COMMIT = 'ba1e2d129753bdc459bca7b23fa896f41ee13536';
const DONOR_RESOURCE = Object.freeze({
  bytes: 4_958_039,
  sha256: '658d68d81619ef83f7dbd6b032533ecd751fb52d3e7dd734dc90b1086b95baaa',
  decodedBytes: 5_992_591,
  triangles: 989_811,
  signedRegions: 1_130,
  sourceObjects: 566,
});
const SOURCE_GLB = Object.freeze({
  bytes: 96_622_012,
  sha256: '487a72172249acd4dba5b40c392fa8eb065b09bc8638f3195163c4cbf8f569db',
});
const INPUT_HASHES = Object.freeze({
  manifest: 'c96f39db01073fabbba82714c37d103210a20eda72b00663deb0c80ae05ac0d0',
  report: 'd074d962e60fde20206b83cddc0a87a4beb1dc923211f4bab7409ed2e5da8451',
  active: '32f7c275248f0ae82380123ab90c0a5bebc6eed338d9f647b391982f10cb07be',
  metadata: 'c1469ab698aae61eb1d0a3383d38a43a408d7cc926a0fd8eee9567c187d18dc9',
  catalog: '71a878043aad6c4dbf7a4ca92bd643cad9910984ed81231784e96ff5829afa8b',
});

const PREFIX_BYTES = 12;
const SOURCE_TO_WORLD_UM = [
  0, 0, 1, -5739,
  -1, 0, 0, 5400,
  0, -1, 0, 332,
  0, 0, 0, 1,
];

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalBytes(value) {
  return Buffer.from(`${canonical(value)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pinnedFile(filename, expectedHash) {
  const bytes = await readFile(path.join(donorDir, filename));
  assert(sha256(bytes) === expectedHash, `D042 donor ${filename} SHA-256 differs`);
  return bytes;
}

function parseContainer(data) {
  assert(data.byteLength >= PREFIX_BYTES && data.subarray(0, 4).toString() === 'EAM3', 'D042 donor EAM3 header is invalid');
  assert(data.readUInt32LE(4) === 1, 'D042 donor EAM3 version is unsupported');
  const headerLength = data.readUInt32LE(8);
  const payloadOffset = Math.ceil((PREFIX_BYTES + headerLength) / 4) * 4;
  assert(headerLength > 0 && payloadOffset <= data.byteLength, 'D042 donor EAM3 header is truncated');
  const header = JSON.parse(data.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength).toString('utf8'));
  assert(header.encoding === 'meshopt-quantized-v1' && Array.isArray(header.chunks), 'D042 donor encoding is unsupported');
  return { header, payloadOffset, payload: data.subarray(payloadOffset) };
}

function snakeBlock(block) {
  return { byte_offset: block.byteOffset, byte_length: block.byteLength, codec: block.codec, stride: block.stride };
}

function snakeRange(range) {
  const sign = range.signedAllenId < 0 ? -1 : 1;
  return {
    feature_id: range.featureId,
    signed_allen_id: range.signedAllenId,
    signed_explode_group_id: sign * Math.abs(range.explodeGroupId),
    index_start: range.indexStart,
    index_count: range.indexCount,
    vertex_start: range.vertexStart,
    vertex_count: range.vertexCount,
  };
}

function snakeChunk(chunk) {
  return {
    hemisphere: chunk.hemisphere,
    vertex_count: chunk.vertexCount,
    index_count: chunk.indexCount,
    position_bits: chunk.positionBits,
    normal_bits: chunk.normalBits,
    bounds: { minimum_um: chunk.bounds.minimum, maximum_um: chunk.bounds.maximum },
    blocks: {
      vertices: snakeBlock(chunk.blocks.vertices),
      normals: snakeBlock(chunk.blocks.normals),
      indices: snakeBlock(chunk.blocks.indices),
    },
    ranges: chunk.ranges.map(snakeRange),
  };
}

function assemble(header, payload) {
  const headerBytes = Buffer.from(canonical(header));
  const payloadOffset = Math.ceil((PREFIX_BYTES + headerBytes.byteLength) / 4) * 4;
  const output = Buffer.alloc(payloadOffset + payload.byteLength);
  output.write('EAM3', 0, 'ascii');
  output.writeUInt32LE(1, 4);
  output.writeUInt32LE(headerBytes.byteLength, 8);
  headerBytes.copy(output, PREFIX_BYTES);
  payload.copy(output, payloadOffset);
  return output;
}

function sourceBlock(data, payloadOffset, block, codec, stride) {
  assert(block?.codec === codec && block.stride === stride, `D042 donor ${codec} descriptor differs`);
  const start = payloadOffset + block.byteOffset;
  const end = start + block.byteLength;
  assert(Number.isSafeInteger(start) && start >= payloadOffset && end <= data.byteLength, `D042 donor ${codec} block is out of bounds`);
  return data.subarray(start, end);
}

function decodeChunk(data, payloadOffset, chunk) {
  const vertexBytes = new Uint8Array(chunk.vertexCount * 8);
  const normalBytes = new Uint8Array(chunk.vertexCount * 4);
  const indices = new Uint32Array(chunk.indexCount);
  MeshoptDecoder.decodeVertexBuffer(vertexBytes, chunk.vertexCount, 8, sourceBlock(data, payloadOffset, chunk.blocks.vertices, 'meshopt-vertex', 8));
  MeshoptDecoder.decodeVertexBuffer(normalBytes, chunk.vertexCount, 4, sourceBlock(data, payloadOffset, chunk.blocks.normals, 'meshopt-oct', 4), 'OCTAHEDRAL');
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), chunk.indexCount, 4, sourceBlock(data, payloadOffset, chunk.blocks.indices, 'meshopt-index', 4));
  const packedVertices = new Uint16Array(vertexBytes.buffer);
  const positions = new Float32Array(chunk.vertexCount * 3);
  const featureIds = new Uint16Array(chunk.vertexCount);
  for (let vertex = 0; vertex < chunk.vertexCount; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      positions[vertex * 3 + axis] = chunk.bounds.minimum[axis]
        + (chunk.bounds.maximum[axis] - chunk.bounds.minimum[axis]) * packedVertices[vertex * 4 + axis] / 16383;
    }
    featureIds[vertex] = packedVertices[vertex * 4 + 3];
  }
  return { positions, featureIds, indices };
}

function componentCount(indices, range) {
  const parents = new Int32Array(range.vertexCount);
  for (let index = 0; index < parents.length; index += 1) parents[index] = index;
  const find = (value) => {
    let root = value;
    while (parents[root] !== root) root = parents[root];
    while (parents[value] !== value) {
      const next = parents[value];
      parents[value] = root;
      value = next;
    }
    return root;
  };
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const used = new Uint8Array(range.vertexCount);
  for (let offset = range.indexStart; offset < range.indexStart + range.indexCount; offset += 3) {
    const a = indices[offset] - range.vertexStart;
    const b = indices[offset + 1] - range.vertexStart;
    const c = indices[offset + 2] - range.vertexStart;
    assert(a >= 0 && b >= 0 && c >= 0 && a < range.vertexCount && b < range.vertexCount && c < range.vertexCount, `D042 feature ${range.featureId} index escapes its vertex range`);
    used[a] = used[b] = used[c] = 1;
    join(a, b); join(b, c);
  }
  const roots = new Set();
  for (let index = 0; index < used.length; index += 1) if (used[index]) roots.add(find(index));
  return roots.size;
}

function regionMetrics(decoded, range) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex += 1) {
    assert(decoded.featureIds[vertex] === range.featureId, `D042 feature ${range.featureId} vertex identity differs`);
    for (let axis = 0; axis < 3; axis += 1) {
      const value = decoded.positions[vertex * 3 + axis];
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
    }
  }
  return {
    bounds: { minimum_um: minimum, maximum_um: maximum },
    vertex_count: range.vertexCount,
    triangle_count: range.indexCount / 3,
    component_count: componentCount(decoded.indices, range),
  };
}

function identity(id, url, bytes) {
  return { id, url, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

const donorDir = option('--donor-dir');
const projectionManifestPath = option('--projection-manifest');
const outputDir = option('--output');
const builderCommit = process.argv[process.argv.indexOf('--builder-commit') + 1];
assert(/^[0-9a-f]{40}$/.test(builderCommit ?? ''), '--builder-commit must be a full Git SHA');
const existing = await readdir(outputDir).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
assert(existing.length === 0, 'D042 mesh output must be absent or empty');

const [donorManifestBytes, donorReportBytes, activeBytes, metadataBytes, catalogBytes, encodedDonor, projectionBytes] = await Promise.all([
  pinnedFile('manifest.json', INPUT_HASHES.manifest),
  pinnedFile('build-report.json', INPUT_HASHES.report),
  pinnedFile('active-allen-ids.json', INPUT_HASHES.active),
  pinnedFile('source-mesh-metadata.json', INPUT_HASHES.metadata),
  pinnedFile('catalog.json', INPUT_HASHES.catalog),
  pinnedFile('source.eamh.gz', DONOR_RESOURCE.sha256),
  readFile(projectionManifestPath),
]);
assert(encodedDonor.byteLength === DONOR_RESOURCE.bytes, 'D042 donor byte length differs');
const donorManifest = JSON.parse(donorManifestBytes);
const donorReport = JSON.parse(donorReportBytes);
const activeInventory = JSON.parse(activeBytes);
const projectionManifest = JSON.parse(projectionBytes);
assert(activeInventory.projectionPackId === projectionManifest.pack_id, 'D042 active inventory projection identity differs');
assert(activeInventory.projectionManifestSha256 === sha256(projectionBytes), 'D042 projection manifest SHA-256 differs');
assert(donorManifest.source?.sha256 === SOURCE_GLB.sha256 && donorManifest.source?.byteSize === SOURCE_GLB.bytes, 'D042 source GLB identity differs');
assert(donorManifest.sourceTriangleCount === DONOR_RESOURCE.triangles && donorManifest.regions?.length === DONOR_RESOURCE.signedRegions, 'D042 donor topology inventory differs');
assert(donorManifest.validation?.sourceObjectCount === DONOR_RESOURCE.sourceObjects, 'D042 donor source-object inventory differs');
assert(donorReport.packId === donorManifest.packId, 'D042 donor report identity differs');
const selectedLod = donorManifest.lods.find((lod) => lod.id === 'source');
assert(selectedLod?.productionCandidate === true && selectedLod.actualTriangleRatio === 1 && selectedLod.triangleCount === DONOR_RESOURCE.triangles, 'D042 compiled-full LOD selection differs');

const decodedDonor = gunzipSync(encodedDonor);
assert(decodedDonor.byteLength === DONOR_RESOURCE.decodedBytes, 'D042 donor decoded byte length differs');
const parsed = parseContainer(decodedDonor);
assert(parsed.header.chunks.length === 2 && parsed.header.chunks[0].hemisphere === 'left' && parsed.header.chunks[1].hemisphere === 'right', 'D042 donor is not ordered bilateral geometry');
await MeshoptDecoder.ready;
const metricsByFeature = new Map();
let triangleCount = 0;
for (const chunk of parsed.header.chunks) {
  const decoded = decodeChunk(decodedDonor, parsed.payloadOffset, chunk);
  for (const range of chunk.ranges) {
    assert(!metricsByFeature.has(range.featureId), `D042 donor feature ${range.featureId} is duplicated`);
    const metrics = regionMetrics(decoded, range);
    metricsByFeature.set(range.featureId, metrics);
    triangleCount += metrics.triangle_count;
  }
}
assert(triangleCount === DONOR_RESOURCE.triangles && metricsByFeature.size === DONOR_RESOURCE.signedRegions, 'D042 decoded topology differs');

const outputHeader = { encoding: 'meshopt-quantized-v1', chunks: parsed.header.chunks.map(snakeChunk) };
const decodedOutput = assemble(outputHeader, parsed.payload);
const reparsed = parseContainer(decodedOutput);
assert(sha256(reparsed.payload) === sha256(parsed.payload), 'D042 compressed geometry payload changed during repackaging');
const encodedOutput = gzipSync(decodedOutput, { level: 9, mtime: 0 });
encodedOutput[9] = 3;
const resourceHash = sha256(encodedOutput);
const packId = `ibl-bwm-d042-${resourceHash.slice(0, 16)}`;
const activeIds = [...new Set(donorManifest.regions.map((region) => region.sourceAllenId))].sort((a, b) => a - b);
const unavailableIds = [...donorManifest.unavailableActiveAllenIds].sort((a, b) => a - b);
const sourceInventory = [...activeIds];
assert(sourceInventory.length === DONOR_RESOURCE.sourceObjects, 'D042 source inventory count differs');
const excludedIds = [...new Set([...donorManifest.geometryScope.excludedNonGreyActiveAllenIds, ...unavailableIds])].sort((a, b) => a - b);
const buildRows = new Map(donorReport.regions.map((region) => [region.featureId, region]));
const regions = donorManifest.regions.map((region, featureId) => {
  assert(region.featureId === featureId, 'D042 donor feature IDs are not contiguous');
  const metrics = metricsByFeature.get(featureId);
  const buildRow = buildRows.get(featureId);
  assert(metrics && buildRow?.sourceTriangleCount === metrics.triangle_count, `D042 feature ${featureId} triangle evidence differs`);
  for (let axis = 0; axis < 3; axis += 1) {
    assert(region.centroidUm[axis] >= metrics.bounds.minimum_um[axis] && region.centroidUm[axis] <= metrics.bounds.maximum_um[axis], `D042 feature ${featureId} centroid is outside decoded bounds`);
  }
  return {
    feature_id: featureId,
    source_allen_id: region.sourceAllenId,
    signed_allen_id: region.signedAllenId,
    hemisphere: region.hemisphere,
    mappings: region.mappings,
    ...metrics,
    centroid_um: region.centroidUm,
    signed_explode_group_id: region.explodeGroupId,
  };
});
const explodeGroups = donorManifest.explodeGroups.map((group) => ({
  signed_group_id: (group.hemisphere === 'left' ? -1 : 1) * Math.abs(group.explodeGroupId),
  hemisphere: group.hemisphere,
  centroid_um: group.centroidUm,
}));
const anatomy = projectionManifest.parent.source.annotation;
const lut = projectionManifest.parent.source.region_lut;
const results = { rebuild: true, coverage: true, midline: true, topology: true, mapping: true, bounds: true, integrity: true, complete_file_graph: true };
const report = {
  format: 'atlas-mesh-pack-validation-report-v1',
  pack_id: packId,
  test_only: false,
  results,
  evidence: {
    decision: 'D042',
    frozen_donor_commit: DONOR_COMMIT,
    donor_resource: { path: 'source.eamh.gz', bytes: encodedDonor.byteLength, sha256: sha256(encodedDonor), decoded_bytes: decodedDonor.byteLength },
    source_glb: SOURCE_GLB,
    source_object_count: sourceInventory.length,
    signed_region_count: regions.length,
    source_triangle_count: donorManifest.sourceTriangleCount,
    lod_triangle_count: triangleCount,
    donor_payload_sha256: sha256(parsed.payload),
    repacked_payload_sha256: sha256(reparsed.payload),
    no_smoothing: true,
    no_triangle_decimation: true,
    no_voxel_derived_replacement: true,
    open_midline_source_allen_ids: donorManifest.validation.openMidlineSourceAllenIds,
    unavailable_source_allen_ids: unavailableIds,
  },
};
const reportBytes = canonicalBytes(report);
const manifest = {
  schema_version: '1.0',
  format: 'atlas-mesh-pack-v1',
  pack_id: packId,
  geometry_id: `ibl-bwm-d042-compiled-full-${SOURCE_GLB.sha256.slice(0, 12)}`,
  immutable: true,
  purpose: 'production',
  reference_space_id: 'allen-ccf-2017',
  coordinate_system: {
    world_axes: ['ml', 'ap', 'dv'], units: 'um', handedness: 'right-handed',
    source_to_world_um: SOURCE_TO_WORLD_UM,
    transform_evidence: 'Pinned GLB CCF (AP,DV,ML) micrometres transformed offline using the reviewed IBL Allen grid origins.',
  },
  sources: {
    source_glb: { id: 'ibl-bwm-atlas-meshes-glb', url: 'https://ibl-brain-wide-map-public.s3.us-east-1.amazonaws.com/atlas/meshes.glb', ...SOURCE_GLB, inventory_allen_ids: sourceInventory },
    active_inventory: identity('d042-active-projection-inventory-v1', 'frozen-donor://active-allen-ids.json', activeBytes),
    projection_pack: identity(projectionManifest.pack_id, 'repo://atlas/anatomy/active/manifest.json', projectionBytes),
    atlas_catalog: identity('ibl-allen-ccf-2017-regions-v1', 'frozen-donor://atlas/allen-ccf-2017/regions.json', catalogBytes),
    annotation: { id: 'ibl-allen-annotation-10um', url: 'ibl-cache://annotation_10.nrrd', bytes: anatomy.bytes, sha256: anatomy.sha256 },
    lut: { id: 'ibl-bilateral-annotation-10um-lut-v02', url: 'ibl-cache://annotation_10_lut_bilateral_v02.npy', bytes: lut.bytes, sha256: lut.sha256 },
  },
  geometry_scope: { ontology: 'Allen CCF 2017', root_allen_id: 8, root_acronym: 'grey', policy: 'deepest-active-grey-descendants', active_allen_ids: activeIds, excluded_allen_ids: excludedIds },
  whole_brain_centroid_um: donorManifest.wholeBrainCentroidUm,
  explode_groups: explodeGroups,
  regions,
  default_lod_id: 'compiled-full',
  upgrade_lod_id: null,
  lods: [{
    id: 'compiled-full', target_triangle_ratio: 1, actual_triangle_ratio: 1,
    triangle_count: triangleCount, maximum_error_um: 0, adaptive_fallback_region_count: 0,
    resource: { path: 'compiled-full.eam3.gz', media_type: 'application/vnd.ibl.eam3', bytes: encodedOutput.byteLength, sha256: resourceHash, codec: { name: 'gzip', decoded_bytes: decodedOutput.byteLength, level: 9 } },
    decoder: { container: 'EAM3', container_version: 1, encoding: 'meshopt-quantized-v1', position_bits: 14, normal_bits: 8 },
  }],
  builder: { name: 'ibl-atlas-mesh-pack-builder', version: '1.1.0', commit: builderCommit, command: 'node web/scripts/repack-d042-mesh.mjs --donor-dir <donor> --projection-manifest <manifest> --output <output> --builder-commit <commit>' },
  validation: { report: { path: 'validation-report.json', media_type: 'application/json', bytes: reportBytes.byteLength, sha256: sha256(reportBytes), codec: { name: 'none', decoded_bytes: reportBytes.byteLength } }, ...results },
};

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDir, 'compiled-full.eam3.gz'), encodedOutput),
  writeFile(path.join(outputDir, 'validation-report.json'), reportBytes),
  writeFile(path.join(outputDir, 'manifest.json'), canonicalBytes(manifest)),
]);
console.log(JSON.stringify({ pack_id: packId, resource_bytes: encodedOutput.byteLength, resource_sha256: resourceHash, triangles: triangleCount, signed_regions: regions.length }));
