# Region hover and selection performance

Status: active benchmark runbook and local implementation evidence.

## Implemented behavior

Selection changes update membership attributes only on affected retained region
rows. Values, search highlights, hierarchy, collapsed branches, keyboard focus,
and scroll position stay intact. Non-count values reuse one number formatter.
Data, statistic, order and colorbar changes still invalidate the full tree.

Ready hover reuses the last resolved application presentation. It updates the
logical tree/histogram feedback, bilateral 2-D highlights and signed physical
3-D hover without running the full application/shell/regional-panel render.
The viewport factory recognizes a hover-only change by unchanged content
references and presentation options. SVG renderers touch changed highlight
classes only; scalar Canvas pixels, selection overlays, colors and crosshair
guides are retained. Direct region transitions emit one hover update. Leaving
an actual region still clears hover and inspection. Loading, errors and mapping
transitions retain the existing full-render guards. Tooltip inspection remains
separate and may still perform layout work.

## Local comparison, 2026-10-14

Real W39 channel release through the v7 development bundle, Allen regional
AP RMS, default linked slices, Linux x64 / Intel i9-14900K, headless Chromium
151, 1440×1000 CSS pixels. Twenty actual mouse hover/click pairs used identical
coordinates, signed IDs and SVG complexity order before and after the change.
Each sample selected a region without modifiers; repeated logical identities
can toggle selection. No CPU/network throttle or CPU profiler was enabled.

| metric | baseline p50 | optimized p50 | baseline p95 | optimized p95 |
| --- | ---: | ---: | ---: | ---: |
| hover handler | 18.1 ms | 8.2 ms | 28.3 ms | 13.3 ms |
| click handler | 48.0 ms | 20.3 ms | 60.3 ms | 33.0 ms |
| click two-frame proxy | 84.1 ms | 29.9 ms | 101.8 ms | 44.5 ms |

The before/after comparison recorded 20 long tasks up to 113 ms before, versus
one 56 ms task after. The separate three-trial benchmark exercises 60 pairs
with distinct logical region identities and slightly broader geometry: hover
handler p50/p95 8.3/14.4 ms, click handler 22.5/29.5 ms, and click frame proxy
32.8/42.0 ms. These are exploratory host measurements, not universal budgets
or production-network evidence. Raw inputs and samples are recorded in
[`region-interaction-20261014-comparison.json`](../../benchmarks/rendering/region-interaction-20261014-comparison.json)
and [`region-interaction-20261014-results.json`](../../benchmarks/rendering/region-interaction-20261014-results.json).

An earlier recording of the owner's existing Chrome 155 tab contained 22
sampled click-handler groups with p50 55 ms and maximum 76 ms. About half of
sampled click processing was in the region tree and another quarter in selection
overlay updates. That CPU recording established the optimization targets but
lost its separate page-side observer collection, so it provides no reliable
baseline click-to-presentation measurement. No 500 ms end-to-end claim is made.
The full live profile is ignored local evidence in `artifacts/interaction-perf/`.

## Repeat the whole-application benchmark

From the repository root:

```sh
cd web
EPHYS_ATLAS_INTERACTION_BENCHMARK_OUTPUT=../artifacts/interaction-perf/results.json \
  npm run benchmark:interaction
```

The opt-in Playwright configuration boots the current real v7 development
bundle on an isolated port. It may acquire missing pinned local artifacts.
It does not use the golden fixture and is separate from `just check`.
Three fresh-page trials sample up to 20 hittable distinct logical regions in
the first registered slice, ordered by SVG path-string length. This heuristic
is not exhaustive worst-case coverage. Other linked slices also update.

Capture-to-document-bubble measures handler duration. Two successive animation
frame callbacks provide a frame-delivery proxy, **not** exact displayed pixels
or presentation timestamps. Browser long tasks include later layout/rendering.
The benchmark verifies trusted input, complete samples and final selection.
Keep timing assertions out of ordinary CI; deterministic browser regressions
instead verify retained tree descendants/focus, linked hover without full
renders, and volume hover without scalar repaint.

## Measure the existing Chrome tab

Chrome 144+ can enable remote debugging at
`chrome://inspect/#remote-debugging` without restarting. Chrome requires its own
approval when the recorder connects. Leave one atlas tab open, then run:

```sh
node benchmarks/rendering/live-region-interaction.mjs \
  artifacts/interaction-perf/live-streamed.json
```

Once the terminal reports that recording has started, reproduce hover/clicks
in the atlas and press Enter in the terminal to stop. The Linux default port
file is `~/.config/google-chrome/DevToolsActivePort`; override
`ATLAS_CHROME_PORT_FILE` for another profile or host. The recorder inspects
only the atlas target and does not close Chrome or modify scientific/view state.

Handler timings, frame proxies, browser Event Timing and long tasks stream
through a CDP binding to a `.ndjson` journal as they occur. A preload script
reinstalls observers after page reloads; document time origins keep interactions
from different documents separate. The completed JSON includes the longest
Event Timing entry per interaction. Entries predating each document's recording
are excluded. Event Timing duration is browser-quantized, and short interactions
may fall below the 16 ms requested threshold; hover uses the handler/frame
records because pointer movement has no discrete interaction ID. No CPU profiler
runs in this recorder. Always compare matching workspace/selection/3-D state.

The recorder was exercised in isolated Chromium with trusted clicks before and
after a forced page reload: both documents, both click handlers and both Event
Timing interactions survived. A disconnected or interrupted recorder retains
its journal; page observers and preload/binding are removed on normal completion.
