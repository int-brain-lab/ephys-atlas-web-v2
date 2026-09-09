# Slice prefetch deployment — 2026-09-08

Status: deployed frontend update; focused live QA passed.

D076 is live at <https://ephys-atlas.iblcore.org>. Source commit
`2b69963ea82907666de13ca401b39599e35927e9` produced clean-Linux site build
`030f9be01b5404dd16f88f4961202acd`. Implementation landed in `c6075ae`;
`2b69963` prevents a second download of the three already-visible SVG packs
while asynchronous persistent-cache admission finishes.

The scoped SDK site publisher updated only the v2 immutable site build and
mutable entry page under `aggregates/atlas/ephys-atlas-web-v2/production/`.
It reports `catalog_changed: false`. The five scientific releases, catalog,
anatomy packs, CloudFront configuration, bucket policy, DNS, and v1 were not
modified by this update. Publication transaction:
`b120462736bcf9b900f256391d1f1446046803f3def10981d67a17e9a84d22be`.

## Shipped behavior

- Visible SVG slices load first, then background work warms nearby packs and
  progresses across all three registered orientations. Verified compressed
  bytes use the existing bounded browser Cache API; storage eviction remains
  possible.
- Volume views prefetch one next pack in their direction of travel, according
  to the source's declared layout. New targets/features cancel obsolete work.
  Foreground packs remain separate from optional background requests.
- Feature and dataset transitions retain previous pixels marked Updating.
  Busy feedback ends after each replacement renders, including explicit
  failure handling; pending metadata is not shown as the previous feature's
  statistics. Same-feature presentation controls remain immediate.

## Validation

`just check` passed on the final runtime: 554 builder tests (one skip), 126
publisher tests, 431 web unit tests, 21 rendering tests, 152 browser tests,
four canonical documentation screenshots, strict typecheck/build, and docs
checks. Added regressions cover progressive persistent warming without duplicate
requests, foreground independence, disposal/suspension, variable pack depths,
and updating feedback through successful and failed numeric requests.

[Live evidence](prefetch-live-qa-20260908.json) records Chromium and Firefox:
52 unique registered SVG pack downloads on first visit, zero registered SVG
network downloads after reload, three foreground plus three next-pack volume
requests, delayed feature replacement retaining the previous image, and slice
navigation. Both report no page errors or HTTP error responses. Root and app
routes return HTTP 200, the final build identity, and `Cache-Control: no-cache`.
The HTML publication marker is added by the publisher and is intentionally
absent from the local immutable build's `index.html`.

These are focused smoke measurements, not a new statistical performance study.
Observed volume chooser-to-ready times were 525 ms in Chromium and 601 ms in
Firefox. Four slider assertions took 23–72 ms and 49–132 ms respectively,
including automation overhead. D075's frozen benchmark remains unchanged.
An earlier Chromium smoke trial had two cold navigation requests near 0.9 s;
cache warming does not guarantee a fixed latency for arbitrary cold jumps.

Raw runners, screenshots, build receipts and initial/final reports remain under
ignored `artifacts/deployment-prefetch-20260908/`. Native Safari and broader
promotion QA retain their existing scope in the initial deployment record.

## Immediate SVG feedback follow-up

Commit `dd76aa5` removes the 400 ms retained-slice notice delay and shows
Loading atlas in empty views. Published site build
`26c142e513a9ff5ed842ecd9049e4b68` supersedes the build above. `just check`
passed (153 browser tests); a live Chromium check blocked SVG requests, verified
visible loading feedback, then released them and verified that busy feedback
cleared after rendering. Publication left the catalog unchanged. Raw receipts
and live evidence are in `artifacts/deployment-svg-feedback-20260908/`.

## Direction-aware SVG prefetch follow-up — 2026-09-09

Commit `7055d68` is live at <https://ephys-atlas.iblcore.org> as immutable site
build `248e8ab01b842f32e76867df634d8e1b`. The scoped production site transaction
`0c8b27430383c862496ec59fcfab37ca239f75f77985c5cadd8c5e8a756e44b1`
left the catalog and scientific artifacts unchanged.

The update prefetches the next whole SVG pack in the committed navigation
direction and lets user-directed work preempt generic cache warming. Interrupted
warming remains resumable. A live Chromium smoke test crossed the coronal pack
boundary from asset index 660 to 708 with no page or HTTP errors. Both `/` and
`/app/` returned HTTP 200, `Cache-Control: no-cache`, and references to the new
immutable build. Raw build, publication, HTTP, and smoke evidence is retained
under ignored `artifacts/deployment-directional-prefetch-20260909/`.

The first CI run exposed a timing race in the synthetic adjacent-pack failure
test because startup directional prefetch could finish its fixed-delay 503
before navigation reused the request. The test now gates that response until
the delayed progress state is observed. It passed ten concurrent repetitions
and the full `just check`, including all 155 browser tests.

## Projection loading activity follow-up — 2026-09-09

Commit `1b6a340` is live as immutable site build
`e90abd0d628c87aa01471c7bd7ea60bd`. Production site transaction
`f34795960eb993ef4379c4f80cf4d993cf48da1a075df502a130db36dc3c5534`
left the catalog and scientific artifacts unchanged.

The foreground slice spinner is now a higher-contrast 16 px ring in the
existing fixed header slot. Interaction-triggered directional SVG and volume
lookahead show a separate `Preparing slices` pill inside only the projection
doing the background work; startup warming stays silent. Completion,
cancellation and viewport suspension clear the projection-local activity.

The final source passed `just check` with 554 builder tests (one skip), 126
publisher tests, 435 web unit tests, 21 rendering tests, 156 browser tests and
four canonical screenshot checks. CI run
[`34360837671`](https://github.com/int-brain-lab/ephys-atlas-web-v2/actions/runs/34360837671)
passed. Live Chromium checks blocked the relevant production SVG request and
verified the projection-local pill, the 16 px/3 px foreground spinner, zero
coordinate displacement and cleanup after each request. Both `/` and `/app/`
served the new build with HTTP 200 and `Cache-Control: no-cache`; the browser
reported no page or HTTP errors. Raw receipts, screenshots and smoke reports
are retained under ignored `artifacts/deployment-loading-activity-20260909/`.
