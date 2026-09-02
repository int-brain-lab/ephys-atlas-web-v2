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

const expected = (selection, automaticColormap, effectiveColormap, divergingCenter) => ({
  selection,
  automaticColormap,
  effectiveColormap,
  availableColormaps: divergingCenter === undefined
    ? ['viridis', 'cividis', 'magma', 'plasma', 'inferno', 'Blues', 'YlOrRd']
    : ['viridis', 'cividis', 'magma', 'plasma', 'inferno', 'Blues', 'YlOrRd', 'coolwarm'],
  ...(divergingCenter === undefined ? {} : { divergingCenter }),
});

test('Auto resolves the active representation preference and falls back to Viridis', () => {
  assert.deepEqual(resolvePresentationColormap('auto', display('magma')), expected('auto', 'magma', 'magma'));
  assert.deepEqual(resolvePresentationColormap('auto', display()), expected('auto', 'viridis', 'viridis'));
  assert.deepEqual(resolvePresentationColormap('auto', display('unregistered')), expected('auto', 'viridis', 'viridis'));
});

test('an explicit registered palette overrides every release preference', () => {
  assert.deepEqual(resolvePresentationColormap('cividis', display('magma')), expected('cividis', 'magma', 'cividis'));
});

test('Coolwarm is available only with a finite release-owned center', () => {
  assert.deepEqual(resolvePresentationColormap('coolwarm', display('magma')), expected('coolwarm', 'magma', 'magma'));
  assert.deepEqual(
    resolvePresentationColormap('auto', { ...display('coolwarm'), divergingCenter: 0 }),
    expected('auto', 'coolwarm', 'coolwarm', 0),
  );
});
