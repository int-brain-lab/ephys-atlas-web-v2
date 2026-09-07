import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('CloudFront root routing preserves queries and never rewrites missing data to HTML', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../../../tools/deployment/site-router.js', import.meta.url), 'utf8'), context);
  for (const uri of ['/', '/catalog.json', '/datasets/d/releases/r/absent.bin', '/atlas/projections/p/manifest.json', '/site/builds/b/assets/main.js']) {
    const request = {uri, querystring: {dataset: {value: 'd'}}, method: 'GET'};
    assert.equal(context.handler({request}), request);
    assert.equal(request.uri, uri === '/' ? '/site/index.html' : uri);
    assert.equal(request.querystring.dataset.value, 'd');
  }
});
