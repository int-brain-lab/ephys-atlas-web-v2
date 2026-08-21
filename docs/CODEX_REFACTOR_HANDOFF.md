# Codex refactor handoff

> **Integration notice:** the continuation priorities in this document are
> superseded by `docs/PR4_INTEGRATION_RUNBOOK.md`. PR #4 is now frozen except
> for concrete integration fixes, tests, documentation reconciliation, and
> final validation. Follow the integration runbook to finish with one
> authoritative `main` branch; this handoff must not remain active after the
> integration.

## Purpose

This document is the durable handoff for continuing the pre-alpha architectural refactor of IBL Ephys Atlas Web v2.

The project is still pre-alpha and has no user compatibility burden. The refactor should therefore be **aggressive about internal structure and deliberate about behavior**, while preserving scientific correctness, provenance, deterministic release formats, and the useful implementation work already present.

Guiding principle:

> Preserve scientific correctness and valuable implementation work; do not preserve accidental architecture.

The goal is not a cosmetic cleanup. The repository must be easy to extend through a large amount of upcoming work: additional datasets and vintages, regional and volumetric features, more rendering modes, multiple parcellations, richer linked interactions, remote publishing, local imports, provenance, and future scientific changes.

## Repository / PR checkpoint

- Repository: `rossant/ibl-ephys-atlas-web-v2`
- Pull request: `#4` — `https://github.com/rossant/ibl-ephys-atlas-web-v2/pull/4`
- Branch: `work/refactor-architecture`
- Base branch: `main`
- Base SHA: `d254c714d47b71f680734885e5205a68c4668cd0`
- Implementation head immediately before this handoff commit: `317818742b304276c51c7cccad2478d650c5832b`
- Implementation-head CI: GitHub Actions run `32466840717` / run #211 — **success**
- The PR should remain draft while the remaining architectural work is being performed.

Start from the remote branch, not from any ChatGPT scratch directory:

```bash
git fetch origin
git checkout work/refactor-architecture
git pull --ff-only
```

Then read, in this order:

1. `AGENTS.md`
2. `docs/LAUNCH_SPEC.md`
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/OPEN_QUESTIONS.md`
5. `docs/DECISIONS.md`
6. `docs/ARCHITECTURE.md`
7. `docs/INTEGRATION_STATUS.md`
8. this handoff

## Architectural direction

The intended dependency direction is:

```text
        UI            Rendering
         \              /
          \            /
           application
               |
          domain / core
               |
          data contracts

HTTP / IndexedDB / future object-store adapters
               |
        resource readers
               |
      format materializers
```

Important rules:

- `core/` is independent of UI, rendering, networking, persistence, and product orchestration.
- `domain/` owns typed application state/actions/reducers and must not depend on rendering/UI implementations.
- `application/` owns asynchronous product workflows/lifecycles and should not depend on concrete UI/renderers.
- `data/` owns artifact contracts, validation, materialization, caching, and transport adapters.
- `rendering/` owns renderer/runtime implementations and format-specific rendering adapters.
- `ui/` owns DOM/controllers; complex data shaping should be pure/testable and separate from DOM mutation.
- `app.ts` should remain a composition/presentation root rather than becoming a general service object.

Do not introduce abstractions because they are fashionable. Every abstraction should correspond to an actual variation already known to the product.

## What this PR has changed

### 1. Application lifecycle

Added `web/src/application/dataset-session.ts` and refactored `AtlasApp` to delegate asynchronous dataset/release/region/feature lifecycle to it.

`DatasetSession` now owns:

- catalog load;
- release/manifest resolution;
- region load;
- feature load;
- stale-request suppression;
- opportunistic prefetch;
- lifecycle cancellation.

`AtlasApp` remains responsible for composition, store/URL synchronization, UI wiring and renderer presentation.

The existing cancellable idle-prefetch behavior was deliberately preserved after CI caught a same-tick rescheduling regression. Do not replace it with a naïve immediate sequential queue.

### 2. Core spatial model and dependency direction

Added:

- `web/src/core/spatial.ts`
- `web/src/core/slice-calibration.ts`

Moved renderer-independent coordinate/affine/slice concepts out of `rendering/`.

`domain/reducer.ts` now depends on `core`, not on a renderer implementation. Compatibility files under `rendering/coordinate-space.ts` and `rendering/slice-calibration.ts` are intentionally thin re-exports so existing imports can migrate incrementally.

### 3. Extensible dataset identity and URL state

`DatasetId` is now an open runtime string. Launch datasets are represented separately by `LaunchDatasetId`/`LAUNCH_DATASET_IDS` rather than making the domain type a closed launch enum.

URL state is v3 and now round-trips publisher-defined datasets/releases, including the edge case where a custom dataset's release string equals the configured default release string.

Do not reintroduce a fixed dataset enum into the runtime model. The feature catalog, dataset list, releases, parcellations, and available representations should increasingly be manifest/catalog driven.

### 4. Shared resource/materialization layer

Added the transport-neutral resource boundary:

```ts
interface ResourceReader {
  resolve(base: string, relative: string): string;
  readJson(location: string): Promise<unknown>;
  readArray(location: string, descriptor: BinaryArrayDescriptor): Promise<number[]>;
  readBytes(location: string, signal?: AbortSignal): Promise<ArrayBuffer>;
}
```

HTTP and IndexedDB/local sources now share the regional materialization code in `data/regional-loader.ts`. The duplicated region-index/statistics/histogram decoding path was removed.

Keep transport concerns in adapters and format semantics in materializers. Future S3/object-storage/custom sources should not copy the format implementation.

### 5. Validation subsystem

The former large `web/src/data/validate.ts` implementation is now a stable facade over:

- `data/validation/primitives.ts`
- `binary.ts`
- `catalog.ts`
- `manifest.ts`
- `feature.ts`
- `statistics.ts`
- `payload.ts`
- `local-dataset.ts`

Callers should continue importing the public facade unless they are implementing validation internals.

A cross-language corpus was added:

- `tests/contract-fixtures/manifest-cases.json`
- `tests/test_contract_parity.py`
- `web/test/unit/manifest-contract-corpus.test.js`

Both Python JSON Schema validation and the TypeScript runtime parser must agree on these cases.

Known follow-up: this corpus deliberately covers invariants both implementations promise today, but it does not yet prove complete semantic equivalence. In particular investigate duplicate feature/parcellation identifiers, format/date-time handling, and any enum/range checks implemented only on one side.

### 6. Anatomy rendering architecture

The anatomy subsystem was decomposed into:

- `rendering/anatomy/types.ts`
- `manifest-projection.ts`
- `manifest-validation.ts`
- `manifest.ts`
- `source-types.ts`
- `pack-store.ts`
- the smaller `generated-anatomy-source.ts` application-facing source

Responsibilities are now explicit:

- manifest/version parsing;
- projection/affine validation;
- provenance/validation assertions;
- public types;
- runtime fetch/integrity/decode/cache/LRU;
- source orchestration.

Keep v1/v2/v3 format-specific logic explicit when that aids reproducibility and auditability. Do **not** create a universal anatomy serialization abstraction just to remove version branches.

Old anatomy paths may be removed when they have no remaining:

1. runtime purpose;
2. reproducibility purpose;
3. reference/validation purpose;
4. test/rollback purpose.

If all four are false, delete the code; Git history is the archive.

### 7. Regional UI

The former ~31 KB regional panel controller was decomposed into:

- `ui/regional/model.ts`
- `dom.ts`
- `row-view.ts`
- `tree-view.ts`
- `details-view.ts`
- `controller.ts`
- the small compatibility facade `ui/regional-panel.ts`

Pure value/statistics/search/histogram logic is separated from DOM behavior. Large dynamic tree interactions use delegated events rather than one listener graph per render.

The existing FLIP-style collapse/expand row-reflow animation was restored in `RegionalTreeView` after Playwright caught its omission. Preserve the behavior (or intentionally replace it with an equivalent deliberate UX), including `prefers-reduced-motion` handling.

### 8. Builder architecture

Added `builder/ephys_atlas_builder/regional_release.py` for deterministic mechanics shared by channel and cluster regional releases:

- region ID folding/validation;
- regional grouping;
- region-index/metadata writing;
- regional summary/statistics/histogram output.

Scientific source loading/computation stays dataset-specific.

Channel source discovery/parquet loading/atlas mapping/feature metadata now lives in `channel_source.py`. `channels.py` is build orchestration + manifest semantics + serialization calls.

`clusters.py` now uses the common regional serializer rather than importing underscored channel-builder helpers.

There is currently a narrow compatibility import in `channels.py` for `_feature_info`, `discover_channel_table_dir`, and `fold_region_ids_left` because existing tests still import those historical symbols. A good follow-up is to migrate those tests/callers to the owning modules and remove the compatibility facade.

Do not turn the builders into a generic scientific pipeline DSL. Scientific distinctions between channels/clusters/volumes/BWM should stay visible.

### 9. Sampled indexed SVG tool

`tools/svg_pack/build_sampled.py` was cleaned up after the expanded Python CI exposed a pre-existing syntax error.

The rewritten tool separates deterministic pack identity, projection writing and manifest construction. It still performs byte-preserving SVG fragment extraction from an already validated anatomy-pack-v2 parent; it does not polygonize or scientifically reinterpret geometry.

### 10. Publishing

Publishing retains capability-token authentication. No OAuth/user-account platform was introduced.

Changes include:

- bounded JSON request bodies;
- separately bounded binary chunk requests;
- named/readable request handlers;
- process-wide filesystem mutation locking via `fcntl.flock`;
- shared `MutationLock` in `publishing/.../locks.py`;
- readable `PublishingClient` methods;
- `cleanup-staging` maintenance command;
- stale upload cleanup based on newest activity anywhere in the staging upload tree;
- maintenance uses the same mutation lock as WSGI mutations.

The filesystem-backed model remains appropriate for the current launch. Do not add Flask/FastAPI/Postgres/Redis/ORM/queues merely to make it conventional.

Potential later hardening: authentication hashes high-entropy random bearer tokens with password-style PBKDF2. A fast keyed hash/HMAC may be more appropriate, but migration must be designed explicitly and is not a priority over application architecture.

### 11. Vite/development infrastructure

The custom development middleware was extracted from `vite.config.ts` into:

- `web/dev/anatomy-pack-plugin.ts`
- `web/dev/real-data-plugin.ts`

Keep Vite configuration declarative; substantial HTTP/path/security logic belongs in testable modules.

### 12. CI and architecture tests

CI is now split into Python and web jobs with dependency caching and concurrency cancellation.

Added architectural dependency tests in `tests/test_web_architecture.py` so inner layers cannot silently begin depending on UI/rendering.

Additional tests added for:

- publisher-defined URL state;
- dataset-session lifecycle and stale completion suppression;
- transport-independent regional materialization;
- regional pure model behavior;
- publishing request limits;
- publishing staging maintenance;
- cross-language manifest contract parity.

## Implementation commit history

The implementation commits immediately preceding this handoff are:

1. `1dd5bc7` — dataset session foundation
2. `dc41d83` — renderer-independent spatial foundation
3. `9866d97` — shared regional loader foundation
4. `45c13f9` — publishing request hardening
5. `dfcf6b9` — refactor app composition around dataset sessions
6. `cdb83c1` — move spatial state out of rendering
7. `fb4f199` — stabilize coordinates and extensible URL state
8. `79b22cb` — modularize data contracts and validation
9. `df8e090` — refactor publishing client and request-limit tests
10. `38b0491` — extract shared regional release serialization
11. `2cbfded` — extract development adapters and architecture tests
12. `40083d2` — document architecture and strengthen CI guardrails
13. `5cc4e3d` — separate anatomy manifests from pack runtime
14. `1273c7f` — separate channel source loading from release writing
15. `e119f20` — decompose regional panel UI responsibilities
16. `9d276f8` — add safe publishing staging maintenance
17. `ac182b4` — add cross-language manifest contract corpus
18. `fa56156` — preserve cancellable idle-prefetch semantics
19. `707ef92` — fix builder compatibility and sampled SVG tooling
20. `3178187` — restore regional tree reflow animation

Use `git log --oneline main..HEAD` for the authoritative full SHAs/history.

## Verification status at handoff

The implementation head `317818742b304276c51c7cccad2478d650c5832b` passed the complete remote CI matrix in GitHub Actions run #211 (`32466840717`).

The green run covers:

### Python

- install builder/publishing test environment;
- complete repository Python test suite;
- publishing test suite.

### Web

- `npm ci`;
- strict TypeScript typecheck;
- browser/unit tests;
- rendering tests;
- production Vite build;
- Chromium/Playwright browser suite.

During this refactor CI found and drove fixes for:

- accidental change to idle-prefetch cancellation semantics;
- historical channel-helper imports after module extraction;
- a pre-existing sampled-SVG builder syntax failure exposed by the broader Python gate;
- omitted regional-tree reflow animation after UI decomposition.

Do not skip the browser suite for future UI refactors; it caught a behavior regression that static/unit tests correctly could not.

## Commands for the next agent

Python:

```bash
python -m pip install -e 'builder[test]' -e publishing pytest
python -m pytest -q tests
python -m pytest -q publishing/tests
```

Web:

```bash
cd web
npm ci
npm run typecheck
npm run test:unit
npm run test:rendering
npm run build
npx playwright install --with-deps chromium
npm run test:browser
```

Run the smallest relevant tests while iterating, but run the complete matrix before declaring a refactor stage complete.

## Local/remote durability reconciliation

The ChatGPT environment used an incomplete scratch reconstruction because the shell could not clone GitHub directly. That scratch directory is **not a source of truth**.

Before this handoff, the scratch inventory was exhaustively reconciled against PR #4:

- 69 non-generated substantive scratch files were present;
- 63 of those paths are changed on PR #4 and were durably published there;
- the 6 scratch paths not changed by the PR were hash-checked and are byte-identical to the current remote branch:
  - `web/src/data/cache.ts`
  - `web/src/data/prefetch.ts`
  - `web/src/domain/actions.ts`
  - `web/src/domain/defaults.ts`
  - `web/src/domain/store.ts`
  - `web/tsconfig.json`
- the PR additionally contains later remote-only work not present in that scratch reconstruction, including the shared contract corpus, the sampled-SVG tool fix, and later CI-driven fixes;
- generated `.pyc`, `__pycache__`, `.pytest_cache`, and `web/.test-dist` output were intentionally excluded and are not source work.

Therefore there is no substantive ChatGPT-only implementation that the next agent needs to recover from a local scratch directory. Continue exclusively from `origin/work/refactor-architecture`.

## Remaining refactor plan — priority order

### P0 — decompose `ui/app-shell.ts`

This is now the largest obvious architectural hotspot. It still mixes roughly all of:

- shell model/callback wiring;
- global keyboard controls/help/title;
- dataset menu;
- feature menu;
- parcellation menu;
- coloring/range/colormap controls;
- settings drawer;
- provenance/info dialog;
- view maximization/context menu;
- anatomy view orchestration;
- 3D view controls;
- selected-region/analysis shell DOM;
- a large DOM-reference/listener surface.

Recommended ownership split (adapt names if a better real boundary emerges):

```text
ui/shell/app-shell.ts
ui/header/header-view.ts
ui/header/dataset-menu.ts
ui/header/feature-menu.ts
ui/header/parcellation-menu.ts
ui/workspace/workspace-view.ts
ui/settings/settings-view.ts
ui/dialogs/info-dialog.ts
ui/controls/color-controls.ts
```

Keep `AppShell` as the compatibility/composition facade. Do **not** migrate to React or create a homegrown component framework. Extract controllers/views based on actual ownership and lifecycle.

Before/while doing this, add characterization tests for any behavior not already covered by Playwright. Preserve accessibility/focus/keyboard behavior unless deliberately simplifying it.

### P1 — finish rendering directory organization

Anatomy has a clean internal structure now, but the broader `rendering/` directory is still relatively flat and mixes core helpers, legacy SVG compatibility, volume code, 3D code and renderer implementations.

Move toward something like:

```text
rendering/
  core/
  anatomy/
  indexed-svg/
  volume/
  mesh/
  legacy/
  index.ts
```

Do not perform mechanical moves unless they clarify dependency direction. Keep a stable facade where useful so the application does not learn renderer internals.

### P1 — complete contract parity hardening

Expand the shared Python/TypeScript corpus to cover semantic checks currently enforced on only one side. Audit at least:

- duplicate feature IDs and paths;
- duplicate parcellation IDs;
- supported parcellations/statistics;
- date-time `format` behavior;
- binary descriptor edge cases;
- feature-representation cross references;
- release/catalog identity consistency.

Prefer shared fixtures over adding a large browser JSON-Schema dependency.

### P2 — persistent cache policy

`web/src/data/cache.ts` intentionally remains lean and currently uses CacheStorage for immutable resources plus in-flight request de-duplication.

Failed in-flight requests are retryable, but there is no explicit persistent cache budget/eviction policy. Decide whether the application should:

- retain explicit persistent caching with a bounded/release-aware eviction policy; or
- rely more heavily on normal HTTP/CDN caching.

Do not add an elaborate cache framework before measuring actual asset behavior.

### P2 — assets/repository hygiene

Audit large assets into explicit categories:

1. runtime required;
2. runtime fallback;
3. test fixture only;
4. benchmark/reference only;
5. generated/obsolete.

Only runtime-required/fallback assets should live in Vite `public/` by default. Add a CI size report/budget if that gives a useful guardrail before reaching for Git LFS or another mechanism.

### P2 — CSS ownership

Move generic context-menu CSS out of app-header-specific styling if it is still there. Keep the current plain CSS organization; do not add Sass/Tailwind/CSS-in-JS.

### P2 — compatibility cleanup

Once call sites/tests use their new owning modules:

- remove the narrow historical private-helper exports from `channels.py`;
- migrate remaining imports from rendering compatibility re-export files to `core` where appropriate;
- remove legacy anatomy paths only under the four-purpose rule described above.

### P3 — publishing/auth follow-up

Only after higher-leverage application work:

- consider cleanup/observability for old staging/audit data;
- consider whether random capability tokens need PBKDF2 or should migrate to a fast keyed digest;
- add further deployment hardening when actual deployment topology requires it.

Do not build an identity platform for this launch.

## Known intentionally deferred item

`web/src/ui/app-shell.ts` was inspected in this refactor but deliberately **not** reconstructed/replaced wholesale through the GitHub connector. Its size and broad existing behavior made that riskier than handing it to a real checkout/Codex environment where refactors can be compiled/tested continuously. This is not forgotten work; it is deliberately the first local-Codex continuation task.

## Refactor invariants

Internal APIs and pre-alpha UI behavior may change when that creates a simpler conceptual model. However, changes must be deliberate.

Be much more conservative around:

- scientific meaning;
- coordinate-system definitions;
- provenance;
- deterministic artifact generation;
- immutable release semantics;
- schema/version contracts;
- anatomy alignment/calibration decisions that encode curated scientific/visual work.

Do not casually change serialized artifact formats in a cleanup commit. If a format needs redesign, make it an explicit versioned contract decision with migration/validation tests.

## What not to introduce

Do not add the following merely as part of refactoring:

- React, Vue, Svelte or another frontend framework;
- Redux/Zustand or equivalent global-state framework;
- a dependency-injection framework/service registry;
- Flask/FastAPI simply to replace the small stdlib publishing service;
- PostgreSQL/ORM/Redis/background queues without an actual deployment requirement;
- GraphQL;
- a generic scientific pipeline DSL;
- Tailwind/Sass/CSS-in-JS;
- a universal anatomy serialization abstraction;
- micro-file splitting with no ownership benefit;
- a large lint/formatter stack;
- a hard-coded final feature catalog in the browser.

The current zero-runtime-dependency TypeScript/browser architecture is a strength. Keep it unless actual product complexity proves otherwise.

## Suggested commit discipline for continuation

The project is pre-alpha, so commits can be structurally aggressive, but each should represent one coherent architectural move. Prefer:

- `Decompose shell header controls`
- `Extract workspace view controller`
- `Harden contract parity fixtures`

rather than dozens of mechanical file-move commits.

Keep the PR draft. Push each coherent stage, inspect the diff, and run appropriate tests. Do not merge PR #4 until the remaining desired refactors have been reviewed and the final remote CI is green.
