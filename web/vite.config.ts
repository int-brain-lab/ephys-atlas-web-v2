import { defineConfig } from 'vite';
import { anatomyPackPlugin } from './dev/anatomy-pack-plugin.js';
import { meshPackFixturePlugin } from './dev/mesh-pack-fixture-plugin.js';
import { loadRealDevelopmentRelease, realReleasePlugin } from './dev/real-data-plugin.js';

export default defineConfig(async () => {
  const releasePath = process.env.EPHYS_ATLAS_REAL_RELEASE;
  const base = { plugins: [anatomyPackPlugin(), meshPackFixturePlugin()] };
  if (!releasePath) return base;
  const release = await loadRealDevelopmentRelease(
    releasePath,
    process.env.EPHYS_ATLAS_REAL_FEATURE ?? 'rms_ap.denoised',
  );
  return {
    define: {
      'import.meta.env.VITE_DEFAULT_DATASET_ID': JSON.stringify(release.datasetId),
      'import.meta.env.VITE_DEFAULT_RELEASE_ID': JSON.stringify(release.releaseId),
      'import.meta.env.VITE_DEFAULT_FEATURE_ID': JSON.stringify(release.featureId),
    },
    plugins: [...base.plugins, realReleasePlugin(release)],
  };
});
