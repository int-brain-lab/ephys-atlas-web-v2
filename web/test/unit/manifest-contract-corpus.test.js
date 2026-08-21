import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseDatasetManifestDocument } from '../../.test-dist/data/validate.js';

const corpusPath = new URL('../../../tests/contract-fixtures/manifest-cases.json', import.meta.url);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

for (const fixture of corpus.cases) {
  test(`manifest contract: ${fixture.name}`, () => {
    let valid = true;
    try {
      parseDatasetManifestDocument(fixture.document);
    } catch {
      valid = false;
    }
    assert.equal(valid, fixture.valid);
  });
}
