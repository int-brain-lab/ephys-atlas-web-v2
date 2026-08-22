import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSchemaV1Document } from '../../.test-dist/data/validation/schema-v1.js';
import { decodedResourceCacheKey } from '../../.test-dist/data/schema-v1.js';

const corpusPath = new URL('../../../tests/contract-fixtures/v1/cases.json', import.meta.url);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && '$fixture' in value) return expand(structuredClone(corpus.fixtures[value.$fixture]));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
}

function target(document, pointer) {
  const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let parent = document;
  for (const part of parts.slice(0, -1)) parent = parent[part];
  return [parent, parts.at(-1)];
}

function caseDocument(fixture) {
  const document = expand(structuredClone(corpus.fixtures[fixture.document]));
  for (const [pointer, value] of Object.entries(fixture.set ?? {})) {
    const [parent, key] = target(document, pointer);
    parent[key] = expand(structuredClone(value));
  }
  for (const [pointer, value] of Object.entries(fixture.append ?? {})) {
    const [parent, key] = target(document, pointer);
    parent[key].push(expand(structuredClone(value)));
  }
  return document;
}

for (const fixture of corpus.cases) {
  test(`schema v1 contract: ${fixture.name}`, () => {
    let valid = true;
    try {
      validateSchemaV1Document(caseDocument(fixture), fixture.schema);
    } catch {
      valid = false;
    }
    assert.equal(valid, fixture.valid);
  });
}

test('decoded cache identity ignores relative path and includes bytes plus decoding contract', () => {
  const first = structuredClone(corpus.fixtures.resource4);
  const second = { ...first, sha256: 'f'.repeat(64) };
  const contract = { format: 'raw-binary-array-v1', dtype: 'float32', shape: [1], order: 'C', endianness: 'little' };
  assert.notEqual(decodedResourceCacheKey(first, contract), decodedResourceCacheKey(second, contract));
  assert.notEqual(
    decodedResourceCacheKey(first, contract),
    decodedResourceCacheKey(first, { ...contract, dtype: 'uint32' }),
  );
  assert.equal(decodedResourceCacheKey(first, contract).startsWith(first.path), false);
});
