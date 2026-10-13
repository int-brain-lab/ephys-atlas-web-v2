import assert from 'node:assert/strict';
import test from 'node:test';
import { featureSelection, matchFeature } from '../../.test-dist/application/feature-correspondence.js';

function manifest(datasetId, features, mode = 'denoised') {
  return {
    dataset: { id: datasetId }, provenance: { recipe: { feature_mode: mode } },
    features: features.map(([id, quantity = id]) => ({ id, valueSemantics: { quantity, sourceColumn: quantity } })),
  };
}
const channels = (features, mode) => manifest('ephys_atlas_channels', features, mode);
const volumes = (features) => manifest('ephys_atlas_volumes', features);
const select = (m, index = 0) => featureSelection(m, m.features[index]);

test('exact IDs and metadata-owned renames match in both directions', () => {
  const c = channels([['rms_ap'], ['renamed_psd', 'psd_alpha']]);
  const v = volumes([['rms_ap'], ['psd_alpha']]);
  assert.equal(matchFeature(select(c), v).id, 'rms_ap');
  assert.equal(matchFeature(select(v), c).id, 'rms_ap');
  assert.equal(matchFeature(select(c, 1), v).id, 'psd_alpha');
  assert.equal(matchFeature(select(v, 1), c).id, 'renamed_psd');
});

test('matching IDs cannot override contradictory quantities; CSD variants stay distinct', () => {
  assert.equal(matchFeature(select(channels([['rms_ap']])), volumes([['rms_ap', 'different']])), null);
  assert.equal(matchFeature(select(channels([['psd_alpha_csd']])), volumes([['psd_alpha_csd_diff1']])), null);
  const unrelated = manifest('local', [['rms_ap']]);
  assert.equal(matchFeature(select(unrelated), volumes([['rms_ap']])), null);
  assert.equal(matchFeature(select(channels([['rms_ap']])), unrelated), null);
});

test('variants come from explicit provenance and verified source names', () => {
  const both = channels([['rms_ap.raw', 'rms_ap'], ['rms_ap.denoised', 'rms_ap']], 'both');
  const v = volumes([['rms_ap']]);
  assert.equal(select(both).variant, 'raw');
  assert.equal(select(both, 1).variant, 'denoised');
  assert.equal(matchFeature(select(both), v).id, 'rms_ap');
  assert.equal(matchFeature(select(v), both).id, 'rms_ap.denoised');
  assert.equal(matchFeature(select(v), both, select(both)).id, 'rms_ap.raw');
  assert.equal(matchFeature(select(channels([['rms_ap']], 'raw')), both).id, 'rms_ap.raw');
  const misleading = channels([['unrelated.denoised', 'rms_ap'], ['another', 'rms_ap']], 'both');
  assert.equal(matchFeature(select(v), misleading), null);
});

test('ambiguous aliases fail deterministically regardless of manifest ordering', () => {
  const source = select(channels([['old', 'quantity']]));
  for (const ids of [['one', 'two'], ['two', 'one']]) {
    assert.equal(matchFeature(source, volumes(ids.map((id) => [id, 'quantity']))), null);
  }
});
