import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LAYOUT_PREFERENCES,
  clampPanelWidth,
  parseLayoutPreferences,
  serializeLayoutPreferences,
} from '../../.test-dist/application/layout-preferences.js';

test('panel widths clamp to the bounded desktop ranges', () => {
  assert.equal(clampPanelWidth('regions', 100), 250);
  assert.equal(clampPanelWidth('regions', 500), 420);
  assert.equal(clampPanelWidth('settings', 100), 280);
  assert.equal(clampPanelWidth('settings', 500), 440);
  assert.equal(clampPanelWidth('regions', 333.6), 334);
});

test('layout preferences round-trip widths and collapsed state', () => {
  const preferences = {
    regionsWidth: 312,
    settingsWidth: 388,
    regionsCollapsed: true,
    settingsCollapsed: false,
  };
  assert.deepEqual(parseLayoutPreferences(serializeLayoutPreferences(preferences)), preferences);
});

test('invalid stored preferences fail safely and clamp valid numeric fields', () => {
  assert.deepEqual(parseLayoutPreferences('not-json'), DEFAULT_LAYOUT_PREFERENCES);
  assert.deepEqual(parseLayoutPreferences(JSON.stringify({
    regionsWidth: -4,
    settingsWidth: 900,
    regionsCollapsed: 'yes',
    settingsCollapsed: true,
  })), {
    regionsWidth: 250,
    settingsWidth: 440,
    regionsCollapsed: false,
    settingsCollapsed: true,
  });
});
