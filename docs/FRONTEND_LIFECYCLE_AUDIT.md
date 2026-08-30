# Frontend lifecycle and race-condition audit

Audit completed 2026-08-31. The review covered dataset and feature switching,
aborted fetches and prefetches, rapid slice movement, immutable cache identity,
URL history, local deletion, retained 2-D/3-D synchronization, and explicit
failure recovery.

## Result

No known path can commit stale scientific data after a newer dataset, region,
feature, or viewport request. Dataset-session commits are guarded by dataset,
region, and feature generations, with a final store-identity check before a
feature is exposed
([dataset-session.ts](../web/src/application/dataset-session.ts#L73),
[dataset-session.ts](../web/src/application/dataset-session.ts#L134)). Retained
projection updates likewise use render tokens and abort the superseded render
([retained-projection-viewport.ts](../web/src/rendering/retained-projection-viewport.ts#L291),
[retained-projection-viewport.ts](../web/src/rendering/retained-projection-viewport.ts#L364)).

Three audit findings were fixed:

- A session feature could remain visible while an A → B → A sequence was
  loading. A new feature request now clears the prior payload synchronously and
  obsolete completions cannot restore B
  ([implementation](../web/src/application/dataset-session.ts#L134),
  [regression](../web/test/unit/dataset-session.test.js#L77)).
- Concurrent immutable requests for the same URL were keyed by URL and SHA only.
  In-flight identity now includes URL, SHA-256, and declared byte count, so an
  inconsistent descriptor cannot reuse a differently validated response
  ([implementation](../web/src/data/cache.ts#L25),
  [regression](../web/test/unit/cache.test.js#L32)).
- Deleting the selected local release refreshed the catalog before moving the
  view away from deleted data. The app now replaces the selection with a
  published fallback before refresh, including when refresh fails
  ([implementation](../web/src/app.ts#L441),
  [browser regression](../web/test/browser/local-import.spec.ts#L236)).

## Reviewed evidence

- Dataset, region, and feature switching: generation checks and identity checks
  above; slow-dataset and A → B → A regressions in
  [dataset-session.test.js](../web/test/unit/dataset-session.test.js#L53).
- Cancellation: feature changes cancel prior prefetch work
  ([prefetch.ts](../web/src/data/prefetch.ts#L13),
  [prefetch.test.js](../web/test/unit/prefetch.test.js#L15)); an aborted
  speculative fetch cannot poison a later foreground request
  ([cache.test.js](../web/test/unit/cache.test.js#L5)).
- Rapid slice movement and retained rendering: superseded render tokens are
  rejected before DOM/canvas commits; browser coverage verifies stable composite
  layers and one-plane repaint behavior
  ([volume.spec.ts](../web/test/browser/volume.spec.ts#L250)).
- URL history: context changes push checkpoints, scientific refinements replace,
  pending navigation is preserved, and popstate does not echo
  ([url-history.test.js](../web/test/unit/url-history.test.js#L54)).
- Local deletion and recovery: deletion is isolated and permits reimport; active
  deletion uses replace-history fallback before catalog refresh
  ([local-import.spec.ts](../web/test/browser/local-import.spec.ts#L184),
  [local-import.spec.ts](../web/test/browser/local-import.spec.ts#L236)).
- 2-D/3-D state and failures: shared state remains independent where required,
  while missing or failed 3-D resources leave all three 2-D views available
  ([scene3d-context.spec.ts](../web/test/browser/scene3d-context.spec.ts#L112)).
- Failure recovery: corrupt cached bytes are evicted and retried only through
  integrity verification
  ([cache.test.js](../web/test/unit/cache.test.js#L64)); projection-pack failure
  produces an explicit unavailable frame
  ([app.spec.ts](../web/test/browser/app.spec.ts#L941)).

## Residual bounded risks

| Risk | Severity | Why it is bounded | Next action |
| --- | --- | --- | --- |
| Foreground `DatasetRepositoryPort` manifest, region, and feature methods do not accept `AbortSignal`. | Medium performance; low correctness | Generations prevent stale commits, but superseded network and decode work can continue. | Thread a per-dataset/per-feature signal through the repository and source ports, abort it on supersession, and retain generation checks as the commit authority. |
| `loadCatalog()` has no refresh generation. | Low | Overlapping refreshes can publish an older catalog result last; dataset and scientific payload commits remain separately guarded. | Add a catalog generation (or serialize refreshes) and a deterministic reversed-completion test. |
| WebCrypto SHA-256 work after the response body is buffered is not cancellable. | Low performance | Integrity is still checked before cache admission; cancellation may only waste digest work. | Check the signal immediately before and after `crypto.subtle.digest`; consider a worker only if measurements show material main-thread cost. |
| `AtlasApp.start()` does not retain the store unsubscribe callback, and asynchronous startup lacks an app-level stopped generation. | Low lifecycle | Normal production startup is single-shot, and session/viewport teardown guards scientific commits; repeated start/stop or embedding could leave callbacks or late UI work. | Store and invoke the unsubscribe callback, make start/stop idempotent, and add stop-during-start plus double-start tests. |

These are follow-up hardening opportunities. None is currently evidence of a
scientific stale-commit defect after the generation and render-token guards.
