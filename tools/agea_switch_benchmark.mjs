// Local diagnostic only. Start the AGEA preview per docs/data/AGEA_LOCAL_PREVIEW.md.
// AGEA_BASELINE_REF optionally serves selected old UI/data modules in this test
// browser only, without changing the checkout, server, source or release bytes.
import { chromium } from '../web/node_modules/playwright/index.mjs';
import { transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';
import { execFileSync } from 'node:child_process';

const baseline = process.env.AGEA_BASELINE_REF;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const modules = ['data/cache', 'rendering/chunked-volume-source',
    'rendering/retained-projection-viewport', 'ui/regional/tree-view', 'ui/context-menu'];
  const served = new Set();
  if (baseline) {
    for (const file of modules) {
      const old = await transformWithOxc(execFileSync('git', ['show', `${baseline}:web/src/${file}.ts`],
        { encoding: 'utf8' }), `${file}.ts`);
      await page.route(new RegExp(`/src/${file}\\.(ts|js)(\\?.*)?$`), route => {
        served.add(file);
        return route.fulfill({ body: old.code, contentType: 'application/javascript' });
      });
    }
  }
  await page.goto(process.env.AGEA_PREVIEW_URL ?? 'http://127.0.0.1:4192/');
  await page.waitForFunction(() => document.querySelectorAll('[data-volume-feature]').length === 3);
  const ids = ['71247618', '74511936', '571', '2719', '71247618', '74511936', '571', '2719'];
  const samples = [];
  for (const [index, id] of ids.entries()) {
    await page.locator('[data-context-field=feature] .context-menu__trigger').click();
    await page.getByRole('searchbox', { name: 'Search features…' }).fill(id);
    const milliseconds = await page.evaluate(id => new Promise((resolve, reject) => {
      const start = performance.now();
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Switch timed out')); }, 30_000);
      const observer = new MutationObserver(() => {
        if (document.querySelectorAll(`[data-volume-feature="experiment-${id}"]`).length === 3) {
          observer.disconnect(); clearTimeout(timer);
          requestAnimationFrame(() => resolve(performance.now() - start));
        }
      });
      observer.observe(document.body, { attributes: true, subtree: true });
      document.querySelector(`[data-context-field=feature] [data-context-option="experiment-${id}"]`).click();
    }), id);
    samples.push({ experimentId: id, kind: index < 4 ? 'cold' : 'revisit', milliseconds });
  }
  if (baseline && modules.some(file => !served.has(file))) throw new Error('Baseline module interception incomplete');
  console.log(JSON.stringify({ baseline: baseline ?? null, browser: browser.version(),
    metric: 'programmatic option click to all three rendered planes plus next animation frame',
    scope: 'fresh Chromium context, four local cold genes then revisits; not production-origin acceptance', samples }, null, 2));
} finally {
  await browser.close();
}
