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
  availableColormaps: ['berlin', 'viridis', 'cividis', 'magma', 'plasma', 'inferno', 'Blues', 'YlOrRd', 'coolwarm'],
  uncenteredManualDiverging: selection !== 'auto'
    && ['berlin', 'coolwarm'].includes(effectiveColormap)
    && divergingCenter === undefined,
  ...(divergingCenter === undefined ? {} : { divergingCenter }),
});

test('Auto resolves the active representation preference then a class-specific default', () => {
  assert.deepEqual(resolvePresentationColormap('auto', display('magma')), expected('auto', 'magma', 'magma'));
  assert.deepEqual(resolvePresentationColormap('auto', display()), expected('auto', 'viridis', 'viridis'));
  assert.deepEqual(resolvePresentationColormap('auto', display('unregistered')), expected('auto', 'viridis', 'viridis'));
  assert.deepEqual(resolvePresentationColormap('auto', { ...display(), divergingCenter: 0 }), expected('auto', 'berlin', 'berlin', 0));
  assert.deepEqual(resolvePresentationColormap('auto', { ...display('magma'), divergingCenter: 0 }), expected('auto', 'magma', 'magma'));
});

test('an explicit registered palette overrides every release preference', () => {
  assert.deepEqual(resolvePresentationColormap('cividis', display('magma')), expected('cividis', 'magma', 'cividis'));
});

test('manual diverging palettes persist without a center and declare the uncentered presentation', () => {
  assert.deepEqual(resolvePresentationColormap('coolwarm', display('magma')), expected('coolwarm', 'magma', 'coolwarm'));
  assert.deepEqual(resolvePresentationColormap('berlin', display()), expected('berlin', 'viridis', 'berlin'));
  assert.deepEqual(
    resolvePresentationColormap('auto', { ...display('coolwarm'), divergingCenter: 0 }),
    expected('auto', 'coolwarm', 'coolwarm', 0),
  );
});
