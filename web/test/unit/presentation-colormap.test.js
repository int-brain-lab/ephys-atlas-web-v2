import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePresentationColormap } from '../../.test-dist/application/presentation-colormap.js';

const display = (colormap) => ({
  ...(colormap === undefined ? {} : { colormap }),
  scales: [{ kind: 'linear' }],
  preferredScale: 'linear',
  distributionDomains: [{ kind: 'full' }],
  preferredDistributionDomain: 'full',
});

test('Auto resolves the active representation preference and falls back to Viridis', () => {
  assert.deepEqual(resolvePresentationColormap('auto', display('magma')), {
    selection: 'auto', automaticColormap: 'magma', effectiveColormap: 'magma',
  });
  assert.deepEqual(resolvePresentationColormap('auto', display()), {
    selection: 'auto', automaticColormap: 'viridis', effectiveColormap: 'viridis',
  });
  assert.deepEqual(resolvePresentationColormap('auto', display('unregistered')), {
    selection: 'auto', automaticColormap: 'viridis', effectiveColormap: 'viridis',
  });
});

test('an explicit registered palette overrides every release preference', () => {
  assert.deepEqual(resolvePresentationColormap('cividis', display('magma')), {
    selection: 'cividis', automaticColormap: 'magma', effectiveColormap: 'cividis',
  });
});
