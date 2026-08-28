import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { anatomyPackPlugin } from './dev/anatomy-pack-plugin.js';
import { loadLocalMeshPack, localMeshPackPlugin } from './dev/mesh-pack-plugin.js';
import { meshPackFixturePlugin } from './dev/mesh-pack-fixture-plugin.js';
import { loadLocalProjectionPack, localProjectionPackPlugin } from './dev/projection-pack-plugin.js';
import { loadRealDevelopmentRelease, realReleasePlugin } from './dev/real-data-plugin.js';

export default defineConfig(async () => {
  const releasePath = process.env.EPHYS_ATLAS_REAL_RELEASE;
  const additionalReleasePaths = (process.env.EPHYS_ATLAS_ADDITIONAL_RELEASES ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const projectionPackPath = process.env.EPHYS_ATLAS_PROJECTION_PACK;
  const meshPackPath = process.env.EPHYS_ATLAS_REAL_MESH_PACK;
  const projectionPack = projectionPackPath
    ? await loadLocalProjectionPack(projectionPackPath)
    : null;
  const meshPack = meshPackPath ? await loadLocalMeshPack(meshPackPath) : null;
  const plugins = [
    anatomyPackPlugin(),
    meshPackFixturePlugin(),
    ...(projectionPack ? [localProjectionPackPlugin(projectionPack)] : []),
    ...(meshPack ? [localMeshPackPlugin(meshPack)] : []),
  ];
  const projectionDefine = projectionPack
    ? { 'import.meta.env.VITE_PROJECTION_PACK_URL': JSON.stringify(projectionPack.manifestUrl) }
    : {};
  const meshDefine = meshPack ? {
    'import.meta.env.VITE_BRAIN_MESH_MANIFEST_URL': JSON.stringify(meshPack.manifestUrl),
    'import.meta.env.VITE_BRAIN_MESH_MANIFEST_BYTES': JSON.stringify(meshPack.manifestBytes),
    'import.meta.env.VITE_BRAIN_MESH_MANIFEST_SHA256': JSON.stringify(meshPack.manifestSha256),
  } : {};
  if (!releasePath) return { define: { ...projectionDefine, ...meshDefine }, plugins };
  const release = await loadRealDevelopmentRelease(
    releasePath,
    process.env.EPHYS_ATLAS_REAL_FEATURE ?? 'rms_ap.denoised',
  );
  const additionalReleases = await Promise.all(additionalReleasePaths.map(async (additionalPath) => {
    const manifest = JSON.parse(await readFile(path.resolve(additionalPath, 'manifest.json'), 'utf8')) as {
      features?: Array<{ id?: string }>;
    };
    const featureId = manifest.features?.find((feature) => typeof feature.id === 'string')?.id;
    if (!featureId) throw new Error(`Additional local release has no feature: ${additionalPath}`);
    return loadRealDevelopmentRelease(additionalPath, featureId);
  }));
  return {
    define: {
      ...projectionDefine,
      ...meshDefine,
      'import.meta.env.VITE_DEFAULT_DATASET_ID': JSON.stringify(release.datasetId),
      'import.meta.env.VITE_DEFAULT_RELEASE_ID': JSON.stringify(release.releaseId),
      'import.meta.env.VITE_DEFAULT_FEATURE_ID': JSON.stringify(release.featureId),
      'import.meta.env.VITE_DEFAULT_PARCELLATION_ID': JSON.stringify(
        process.env.EPHYS_ATLAS_REAL_PARCELLATION ?? 'allen',
      ),
    },
    plugins: [...plugins, realReleasePlugin([release, ...additionalReleases])],
  };
});
