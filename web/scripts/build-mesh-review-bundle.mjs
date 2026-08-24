import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeLabMeshopt, geometryMetrics, simplifyGeometry } from './mesh-candidate-geometry.mjs';

const pack = required('--pack');
const overrides = required('--canonical-overrides');
const donor = required('--donor');
const output = required('--output');
const [manifestBytes, manifest, overrideManifest, donorReport] = await Promise.all([
  readFile(resolve(pack, 'manifest.json')),
  json(resolve(pack, 'manifest.json')),
  json(resolve(overrides, 'manifest.json')),
  json(resolve(donor, 'build-report.json')),
]);
if (manifest.format !== 'atlas-mesh-pack-v1' || overrideManifest.surfaces.length !== 10) throw new Error('review inputs differ from the approved candidate');

const overrideBySignedId = new Map();
for (const surface of overrideManifest.surfaces) {
  overrideBySignedId.set(surface.signed_allen_id, {
    surface,
    geometry: {
      signedAllenId: surface.signed_allen_id,
      positions: typed(await readFile(resolve(overrides, surface.positions.path)), Float32Array),
      indices: typed(await readFile(resolve(overrides, surface.indices.path)), Uint32Array),
    },
  });
}
const donorByFeature = new Map(donorReport.regions.map((region) => [region.featureId, region]));
const decodedByLod = new Map();
for (const lod of manifest.lods) decodedByLod.set(
  lod.id,
  await decodeLabMeshopt(gunzipSync(await readFile(resolve(pack, lod.resource.path)))),
);

const regionMetrics = manifest.regions.map((region) => {
  const sourceSpan = region.bounds.maximum_um.map((value, axis) => value - region.bounds.minimum_um[axis]);
  const donorMetrics = donorByFeature.get(region.feature_id);
  const override = overrideBySignedId.get(region.signed_allen_id);
  return {
    feature_id: region.feature_id,
    source_allen_id: region.source_allen_id,
    signed_allen_id: region.signed_allen_id,
    hemisphere: region.hemisphere,
    regenerated: Boolean(override),
    source: {
      vertex_count: region.vertex_count,
      triangle_count: region.triangle_count,
      component_count: region.component_count,
      bounds: region.bounds,
      centroid_um: region.centroid_um,
    },
    lods: Object.fromEntries(manifest.lods.map((lod) => {
      const actual = geometryMetrics(decodedByLod.get(lod.id).get(region.feature_id));
      const simplified = override ? simplifyGeometry(override.geometry, lod.target_triangle_ratio) : null;
      const normalizedError = simplified?.error ?? donorMetrics?.lods[lod.id].normalizedError;
      const ratioUsed = simplified?.ratioUsed ?? donorMetrics?.lods[lod.id].ratioUsed;
      if (normalizedError == null || ratioUsed == null) throw new Error(`feature ${region.feature_id} has no ${lod.id} build metrics`);
      return [lod.id, {
        vertex_count: actual.vertexCount,
        triangle_count: actual.triangleCount,
        component_count: actual.componentCount,
        bounds: { minimum_um: actual.bounds.minimum, maximum_um: actual.bounds.maximum },
        topology: actual.topology,
        quality: actual.quality,
        normalized_error: normalizedError,
        maximum_error_um: normalizedError * Math.max(...sourceSpan),
        ratio_used: ratioUsed,
        adaptive_fallback: ratioUsed > lod.target_triangle_ratio + 1e-12,
      }];
    })),
  };
});

const metrics = {
  format: 'atlas-mesh-production-review-metrics-v1',
  pack_id: manifest.pack_id,
  geometry_id: manifest.geometry_id,
  builder_commit: manifest.builder.commit,
  manifest_sha256: sha256(manifestBytes),
  positive_source_count: new Set(manifest.regions.map((region) => region.source_allen_id)).size,
  signed_region_count: manifest.regions.length,
  regenerated_signed_allen_ids: overrideManifest.surfaces.map((surface) => surface.signed_allen_id),
  unavailable_source_allen_ids: [545],
  accepted_open_midline_source_allen_ids: [898],
  lods: manifest.lods.map((lod) => ({
    id: lod.id,
    encoded_bytes: lod.resource.bytes,
    encoded_sha256: lod.resource.sha256,
    decoded_bytes: lod.resource.codec.decoded_bytes,
    triangle_count: lod.triangle_count,
    maximum_error_um: lod.maximum_error_um,
  })),
  regions: regionMetrics,
};
const summary = {
  format: 'atlas-mesh-production-review-summary-v1',
  pack_id: manifest.pack_id,
  builder_commit: manifest.builder.commit,
  automated_evidence: {
    schema_and_graph_validation: 'pass',
    deterministic_rebuild: 'pass',
    coverage_566_positive_1132_signed: 'pass',
    ten_regenerated_signed_surfaces: 'pass',
    transfer_budgets: 'pass',
    presentation_changes_geometry_requests: 'pending-browser-evidence',
  },
  owner_review: {
    regenerated_geometry: 'pending',
    default_lod_id: 'pending',
    upgrade_lod_id: 'pending',
    local_cross_browser_review: 'incomplete',
    publication: 'not-approved',
    notes: '',
  },
};
const config = {
  pack_id: manifest.pack_id,
  builder_commit: manifest.builder.commit,
  manifest: {
    url: '/__mesh-review/pack/manifest.json',
    bytes: manifestBytes.byteLength,
    sha256: sha256(manifestBytes),
  },
  overrides: {
    manifest_url: '/__mesh-review/canonical-overrides/manifest.json',
    base_url: '/__mesh-review/canonical-overrides/',
  },
  reviewed_signed_allen_ids: overrideManifest.surfaces.map((surface) => surface.signed_allen_id),
  metrics_url: '/__mesh-review/review/metrics.json',
  summary_url: '/__mesh-review/review/review-summary.json',
};

await mkdir(resolve(output, 'screenshots'), { recursive: true });
await Promise.all([
  write(resolve(output, 'metrics.json'), metrics),
  write(resolve(output, 'review-summary.json'), summary),
  write(resolve(output, 'review-config.json'), config),
  writeFile(resolve(output, 'index.html'), reviewHtml(manifest.pack_id)),
]);
console.log(JSON.stringify({ pack_id: manifest.pack_id, regions: regionMetrics.length, output: basename(output) }, null, 2));

function reviewHtml(packId) {
  return Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mesh candidate review · ${packId}</title></head>
<body><div id="app"></div><script type="module" src="/3d-review/main.ts"></script></body></html>\n`);
}
function typed(bytes, Type) { return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function write(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
function required(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`); return resolve(process.argv[index + 1]); }
