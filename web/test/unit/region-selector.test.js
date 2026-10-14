import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SelectorModel } from '../../.test-dist/ui/regional/selector-model.js';

const traces = JSON.parse(readFileSync(new URL('../fixtures/region-selector/traces.json', import.meta.url), 'utf8'));
test('selector fixture mirror pins the complete immutable anatomy bundle', () => {
  const lock = JSON.parse(readFileSync(new URL('../fixtures/region-selector-lock.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../fixtures/region-selector/manifest.json', import.meta.url), 'utf8'));
  const schema = JSON.parse(readFileSync(new URL('../fixtures/region-selector/schema.json', import.meta.url), 'utf8'));
  assert.equal(lock.repository, 'https://github.com/int-brain-lab/ibl-anatomy');
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.path, 'src/ibl_anatomy/region_selector_contract/v1');
  assert.deepEqual(Object.keys(lock.sha256).sort(), ['manifest.json', 'schema.json', 'traces.json']);
  for (const [name, digest] of Object.entries(lock.sha256)) {
    assert.match(digest, /^[0-9a-f]{64}$/);
    const bytes = readFileSync(new URL(`../fixtures/region-selector/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, name);
  }
  assert.deepEqual(manifest.files, {
    'schema.json': lock.sha256['schema.json'], 'traces.json': lock.sha256['traces.json'],
  });
  assert.equal(manifest.contract, 'ibl-region-selector');
  assert.equal(manifest.version, 1);
  assert.equal(traces.contract, manifest.contract);
  assert.equal(traces.version, manifest.version);
  assert.equal(schema.properties.contract.const, manifest.contract);
  assert.equal(schema.properties.version.const, manifest.version);
});

function apply(model, action) {
  switch (action.op) {
    case 'query': model.setQuery(action.value); break;
    case 'order': model.setOrder(action.value); break;
    case 'values': model.setValues(new Map(Object.entries(action.values).map(([id, value]) => [id, value ?? NaN]))); break;
    case 'selection': model.setSelected(new Set(action.selected)); break;
    case 'multiple': model.setMultiple(action.enabled); break;
    case 'focus': model.setFocus(action.id); break;
    case 'hover': model.setHover(action.id); break;
    case 'collapse': model.setExpanded(action.id, false); break;
    case 'expand': model.setExpanded(action.id, true); break;
    case 'collapseAll': model.setAllExpanded(false); break;
    case 'expandAll': model.setAllExpanded(true); break;
    case 'activate': model.activate(action.id, action); break;
    case 'key':
      if (['Enter', ' '].includes(action.key)) model.activate(model.focus, { ...action, keyboard: true });
      else model.navigate(action.key);
      break;
    default: throw new Error(`Unknown selector action ${action.op}`);
  }
}
for (const scenario of traces.scenarios) {
  test(`canonical selector conformance: ${scenario.id}`, () => {
    const model = new SelectorModel(scenario.regions, scenario.initial);
    scenario.actions.forEach((action, index) => {
      apply(model, action);
      assert.deepEqual(model.snapshot(), scenario.expected[index], `${scenario.id} action ${index}: ${JSON.stringify(action)}`);
    });
  });
}

test('host-owned selection effects preserve range anchor until synchronous host reconciliation', () => {
  const scenario = traces.scenarios.find(({ id }) => id === 'ranked-range-and-host-selection-order');
  const model = new SelectorModel(scenario.regions, scenario.initial);
  model.setOrder('value-desc');
  const select = model.activate('a1', { ctrl: true }, true);
  assert.deepEqual(select, { kind: 'select', id: 'a1', additive: true });
  assert.deepEqual(model.snapshot().selected, ['a2']);
  model.setSelected(new Set(['a2', 'a1']));
  const range = model.activate('a2', { shift: true }, true);
  assert.deepEqual(range, { kind: 'range', ids: ['a2', 'a1'], id: 'a2' });
  model.setSelected(new Set(['a2', 'a1']));
  assert.equal(model.snapshot().anchor, 'a1');
});

test('search uses Unicode default lowercase and maps highlight spans to original code points', async () => {
  const { regionMatchesQuery, regionHighlightSpans } = await import('../../.test-dist/ui/regional/model.js');
  const region = { acronym: 'INS', name: 'İnsula ß ΟΣ 😀İnsula' };
  assert.equal(regionMatchesQuery(region, '\uFEFFi\u0307n\uFEFF'), true);
  assert.equal(regionMatchesQuery(region, 'ss'), false);
  assert.equal(regionMatchesQuery(region, 'ος'), true);
  assert.equal(regionMatchesQuery(region, 'οσ'), false);
  assert.deepEqual(regionHighlightSpans('İnsula', 'i\u0307n'), [[0, 2]]);
  assert.deepEqual(regionHighlightSpans('😀İnsula', 'i\u0307n'), [[1, 3]]);
  assert.deepEqual(regionHighlightSpans('İİ', 'i'), [[0, 1], [1, 2]]);
  assert.deepEqual(regionHighlightSpans('İ', '\u0307'), [[0, 1]]);
  assert.deepEqual(regionHighlightSpans('ΟΣ', 'ος'), [[0, 2]]);
});
