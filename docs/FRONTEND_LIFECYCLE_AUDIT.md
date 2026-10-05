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
  ([workspace browser tests](../web/test/browser/app-workspace.spec.ts)).

## Lifecycle and ownership follow-up (2026-10-05)

The catalog session now admits only the newest refresh completion, including
runtime status and errors. App-owned catalog callers also guard navigation with
a refresh generation, so an older caller cannot apply its returned catalog to
the URL controller. Teardown invalidates both layers. Reversed completion,
obsolete failure, and stop-during-refresh cases are covered by
[dataset-session tests](../web/test/unit/dataset-session.test.js) and
[app lifecycle browser tests](../web/test/browser/app-lifecycle.spec.ts).

Foreground feature requests now carry a per-request `AbortSignal` through the
repository to the existing HTTP/local readers. Dataset or feature supersession
and session teardown abort that request; generations remain the commit
authority. Signal-bearing resource fetches do not share cancellable work with
another consumer. Tests cover signal forwarding, cancellation, and late results.

`AtlasApp` already retained and invoked its store unsubscribe callback; the
original audit's contrary statement was incorrect. Startup now shares one
promise, stop is idempotent, and late startup/catalog completions cannot activate
subscriptions or repaint the destroyed shell. A stopped instance is terminal.

Downloads now belong to `ui/download-dialog.ts`, including artifact identity,
stable row state, retries, and disposal. Completion from an earlier opening
cannot close a later reopening of the same dialog. Orthogonal and static frames
share `ui/retained-view-status.ts`, which owns typed requested/displayed content
identities, token checks, busy state, pending/error transitions, retry
invalidation, and timer disposal. Viewports continue to own geometry and actual
asset readiness. Slice feedback retains the D076 150 ms delay; guide-only
supersession cannot suppress that pending geometry cue. Dedicated browser tests
cover these controller lifecycles alongside the existing view loading tests.

## Residual bounded risks

| Risk | Severity | Why it is bounded | Next action |
| --- | --- | --- | --- |
| Shared manifest and region loads are not cancelled by feature supersession. | Medium performance; low correctness | Generations prevent stale commits; shared work may be useful to the next request. | Measure discarded work before adding consumer-aware cancellation to shared promises. |
| IndexedDB transactions already in progress and WebCrypto SHA-256 after buffering cannot be interrupted by the feature signal. | Low performance | Reader signal checks and generation checks prevent obsolete exposure; integrity remains required before cache admission. | Consider interruptible work only if measurements show material cost. |

## Structural work still worth measuring

Local-data dialogs and panel layout now have dedicated controllers. The shell
retains composition, header actions, and responsive drawer coordination. Local
storage/catalog/navigation remain application responsibilities. A panel drag
is terminated on disposal, with a regression proving later window movement
cannot resize the disposed controller.

Regional summary, distribution, and comparison rendering now have distinct
modules; comparison styles follow the same boundary. HTTP and local volume
payloads share a resource-reader materializer. Its transport-location,
integrity-descriptor, lazy-resource, and cancellation behavior has focused tests.
Local resource integrity and bounded decoding are separated from release-graph
validation. Pure registered volume placement and pixel coloring are separated
from retained rendering; scheduling and layer ownership remain in the viewport.
The application browser suite was divided by behavior with its 44 test titles
and bodies preserved. No additional renderer facade was introduced.

The chart/tree audit found an existing presentation-only fast path. A Chromium
probe against the real Tailscale development app exercised 40 pointer hover/leave
transitions: all 874 tree buttons, the chart SVG, and its global curve retained
identity. The only seven child-list mutations were chart `title` text updates.
This supports keeping the existing hover path rather than rewriting it. It does
not measure data/statistic/selection changes, which legitimately invalidate
more presentation; future optimization there should start with profiling and
focus checks. The reproducible local probe is ignored at
`artifacts/local-dev/refactor-hover-probe.mjs`.
