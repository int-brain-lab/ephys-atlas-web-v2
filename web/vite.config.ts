import { defineConfig } from 'vite';
import { anatomyPackPlugin } from './dev/anatomy-pack-plugin.js';
import { meshPackFixturePlugin } from './dev/mesh-pack-fixture-plugin.js';
import { loadLocalProjectionPack, localProjectionPackPlugin } from './dev/projection-pack-plugin.js';
import { loadRealDevelopmentRelease, realReleasePlugin } from './dev/real-data-plugin.js';

export default defineConfig(async () => {
  const releasePath = process.env.EPHYS_ATLAS_REAL_RELEASE;
  const projectionPackPath = process.env.EPHYS_ATLAS_PROJECTION_PACK;
  const projectionPack = projectionPackPath
    ? await loadLocalProjectionPack(projectionPackPath)
    : null;
  const plugins = [
    anatomyPackPlugin(),
    meshPackFixturePlugin(),
    ...(projectionPack ? [localProjectionPackPlugin(projectionPack)] : []),
  ];
  const projectionDefine = projectionPack
    ? { 'import.meta.env.VITE_PROJECTION_PACK_URL': JSON.stringify(projectionPack.manifestUrl) }
    : {};
  if (!releasePath) return { define: projectionDefine, plugins };
  const release = await loadRealDevelopmentRelease(
    releasePath,
    process.env.EPHYS_ATLAS_REAL_FEATURE ?? 'rms_ap.denoised',
  );
  return {
    define: {
      ...projectionDefine,
      'import.meta.env.VITE_DEFAULT_DATASET_ID': JSON.stringify(release.datasetId),
      'import.meta.env.VITE_DEFAULT_RELEASE_ID': JSON.stringify(release.releaseId),
      'import.meta.env.VITE_DEFAULT_FEATURE_ID': JSON.stringify(release.featureId),
      'import.meta.env.VITE_DEFAULT_PARCELLATION_ID': JSON.stringify(
        process.env.EPHYS_ATLAS_REAL_PARCELLATION ?? 'allen',
      ),
    },
    plugins: [...plugins, realReleasePlugin(release)],
  };
});
