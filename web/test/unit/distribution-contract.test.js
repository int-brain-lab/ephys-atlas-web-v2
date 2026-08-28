import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDistributionBinning,
  validateDistributionBinningSet,
} from '../../.test-dist/data/validation/distribution.js';

function binning({ scale = { kind: 'linear' }, domain = { kind: 'full' } } = {}) {
  const focused = domain.kind === 'focused';
  return {
    id: `${scale.kind}-${domain.kind}`,
    scale,
    domain,
    edges: focused ? [-2, 0, 2] : [-10, 0, 10],
    global_counts: focused ? [3, 4] : [5, 5],
    global_underflow_count: focused ? 2 : 0,
    global_overflow_count: focused ? 1 : 0,
    regional_counts: {
      format: 'raw-binary-array-v1',
      dtype: 'uint32',
      shape: [1, 4],
      order: 'C',
      endianness: 'little',
      resource: {
        path: `${scale.kind}-${domain.kind}.u32`,
        media_type: 'application/octet-stream',
        bytes: 16,
        sha256: '0'.repeat(64),
        codec: { name: 'none', decoded_bytes: 16 },
      },
    },
    regional_count_layout: 'underflow-bins-overflow',
    bin_rule: 'left-closed-right-open-last-closed',
  };
}

test('signed-log focused binnings retain the release threshold and exact tails', () => {
  const parsed = parseDistributionBinning(binning({
    scale: { kind: 'symlog', linear_threshold: 0.5 },
    domain: { kind: 'focused', bounds: [-2, 2] },
  }), 'distribution', true);
  assert.deepEqual(parsed.scale, { kind: 'symlog', linearThreshold: 0.5 });
  assert.deepEqual(parsed.domain, { kind: 'focused', bounds: [-2, 2] });
  assert.deepEqual(parsed.global, { binCounts: [3, 4], underflowCount: 2, overflowCount: 1 });
});

test('distribution sets require the complete rectangular scale-domain cross-product', () => {
  const binnings = [
    parseDistributionBinning(binning(), 'distribution[0]', true),
    parseDistributionBinning(binning({ domain: { kind: 'focused', bounds: [-2, 2] } }), 'distribution[1]', true),
    parseDistributionBinning(binning({ scale: { kind: 'symlog', linear_threshold: 1 } }), 'distribution[2]', true),
  ];
  assert.throws(
    () => validateDistributionBinningSet(binnings, 10, 'distribution', -10),
    /rectangular cross-product/,
  );
});

test('log availability is rejected when the complete population is not strictly positive', () => {
  const rawLinear = binning();
  rawLinear.edges = [0.1, 1, 10];
  const linear = parseDistributionBinning(rawLinear, 'distribution[0]', true);
  const rawLog = binning({ scale: { kind: 'log' } });
  rawLog.edges = [0.1, 1, 10];
  const log = parseDistributionBinning(rawLog, 'distribution[1]', true);
  assert.throws(
    () => validateDistributionBinningSet([linear, log], 10, 'distribution', 0),
    /strictly positive population/,
  );
});

test('raw domain endpoints are exact across scales and focused domains stay inside full', () => {
  const linear = parseDistributionBinning(binning(), 'distribution[0]', true);
  const rawSymlog = binning({ scale: { kind: 'symlog', linear_threshold: 1 } });
  rawSymlog.edges = [-10, 0, 10.00000000001];
  const symlog = parseDistributionBinning(rawSymlog, 'distribution[1]', true);
  assert.throws(
    () => validateDistributionBinningSet([linear, symlog], 10, 'distribution', -10, 10),
    /endpoints must be identical across scales/,
  );

  const rawFocused = binning({ domain: { kind: 'focused', bounds: [-11, 2] } });
  rawFocused.edges = [-11, 0, 2];
  const focused = parseDistributionBinning(rawFocused, 'distribution[1]', true);
  assert.throws(
    () => validateDistributionBinningSet([linear, focused], 10, 'distribution', -10, 10),
    /focused domain must lie inside the full domain/,
  );
});

test('full domains may be padded but must enclose both declared population extrema', () => {
  const full = parseDistributionBinning(binning(), 'distribution', true);
  assert.doesNotThrow(() => validateDistributionBinningSet([full], 10, 'distribution', -9, 9));
  assert.throws(
    () => validateDistributionBinningSet([full], 10, 'distribution', -11, 9),
    /population minimum/,
  );
  assert.throws(
    () => validateDistributionBinningSet([full], 10, 'distribution', -9, 11),
    /population maximum/,
  );
});
