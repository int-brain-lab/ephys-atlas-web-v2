import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegionalValueColorbar, regionalValueColorbarPosition } from '../../.test-dist/application/regional-value-colorbar.js';
import { scalarColorNormalize } from '../../.test-dist/application/scalar-colormap.js';

const options = {
  range: [-10, 10], scale: { kind: 'linear' }, colormap: 'viridis',
  colorMapping: 'match', pseudoLogStrength: 0.05,
};

test('finite zero has a position, missing values do not, and clipped values use the edges', () => {
  const bar = buildRegionalValueColorbar(options);
  assert.equal(regionalValueColorbarPosition(0, bar), 0.5);
  assert.equal(regionalValueColorbarPosition(-20, bar), 0);
  assert.equal(regionalValueColorbarPosition(20, bar), 1);
  assert.equal(regionalValueColorbarPosition(NaN, bar), null);
  assert.equal(regionalValueColorbarPosition(Infinity, bar), null);
  assert.match(bar.gradient, /^linear-gradient\(90deg,/);
});

test('pseudo-log and quantile ticks use the atlas normalization rather than linear min-max', () => {
  for (const mapping of ['pseudolog', 'quantile-uniform', 'quantile-gaussian']) {
    const quantiles = mapping === 'pseudolog' ? undefined : {
      kind: mapping, xs: [-10, 0, 1, 10], ys: [-2, -1, 1, 2],
    };
    const bar = buildRegionalValueColorbar({ ...options, colorMapping: mapping, colorQuantiles: quantiles });
    const position = regionalValueColorbarPosition(1, bar);
    const normalized = scalarColorNormalize(1, options.range, options.scale, options.colormap,
      undefined, mapping, options.pseudoLogStrength, quantiles);
    assert.equal(position, normalized);
    assert.notEqual(position, 0.55);
  }
});

test('a one-sided diverging palette spans the whole track while preserving its palette half', () => {
  const bar = buildRegionalValueColorbar({ ...options, range: [2, 10], colormap: 'berlin', divergingCenter: 0 });
  assert.equal(regionalValueColorbarPosition(2, bar), 0);
  assert.equal(regionalValueColorbarPosition(6, bar), 0.5);
  assert.equal(regionalValueColorbarPosition(10, bar), 1);
});

test('logarithmic tracks position a finite zero below the range at the lower edge', () => {
  const bar = buildRegionalValueColorbar({ ...options, range: [1, 100], scale: { kind: 'log' } });
  assert.equal(regionalValueColorbarPosition(0, bar), 0);
  assert.ok(Math.abs(regionalValueColorbarPosition(10, bar) - 0.5) < 1e-12);
});
