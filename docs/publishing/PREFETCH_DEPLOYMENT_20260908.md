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
