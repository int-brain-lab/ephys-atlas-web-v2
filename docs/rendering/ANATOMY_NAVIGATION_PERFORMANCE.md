# Anatomy navigation performance

Status: frozen evidence for the active projection-pack runtime.

## Reproducible browser instrumentation

Run the controlled cold-cache benchmark with:

```sh
just benchmark-anatomy
```

It launches an isolated headless Chromium rather than reusing a developer
browser. Each trial creates a fresh schema-v1 projection-pack source and
retained viewport, cache-busts the selected pack request, and records:

- input-to-DOM-commit and input-to-next-paint;
- long tasks, animation-frame gaps, heap delta, and final-slice correctness;
- cold verified pack load plus worker decode and SVG preparation;
- a second uncached SVG in the same decoded pack and a retained-layer revisit;
- stable viewport DOM across the complete sequence.

Set `EPHYS_ATLAS_ANATOMY_BENCHMARK_OUTPUT` to write the JSON report. To retain a
Playwright timeline with network and browser snapshots, append `--trace on` to
the npm command and inspect the produced trace with `npx playwright show-trace`.

Attaching to an already-open Chrome is possible only when that browser was
started with a remote debugging port. The isolated benchmark is the default
because it controls browser cache, extensions, active tabs, and repeatability.

## Initial Chromium result

Environment: Apple arm64 laptop, 8 logical CPUs, 16 GiB RAM, headless Chromium
151, five cache-busted trials per case. Requests were served from the local
Vite server, so fetch latency is not representative of production; the
main-thread preparation phases are representative of this browser and machine.

| slice | paths | cold commit p50 | cold paint p50 | same-pack commit p50 | retained commit p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| coronal p95, 809 | 345 | 17.4 ms | 17.4 ms | 25.2 ms | 32.8 ms |
| sagittal p95, 605 | 201 | 16.2 ms | 16.6 ms | 25.5 ms | 33.1 ms |
| horizontal p95, 343 | 394 | 18.9 ms | 18.9 ms | 24.6 ms | 33.3 ms |
| horizontal maximum, 400 | 416 | 18.2 ms | 18.2 ms | 24.8 ms | 32.3 ms |

For the horizontal p95 slice, median cold-pack phases were approximately:

| phase | p50 |
| --- | ---: |
| fetch + body read | 1.8 ms |
| SHA-256 | 0.3 ms |
| gzip | 5.3 ms |
| UTF-8 + JSON | 3.1 ms |
| structured pack validation/allocation | 3.3 ms |
| SVG serialization + parse + path index | 1.5 ms |

There were no tasks above the browser's 50 ms `longtask` threshold, but cold
commits generally exceed the 16.7 ms frame budget. SVG parsing is not the main
cold-miss cost: gzip plus JSON decoding and structured validation dominate.

The benchmark also exposes a separate scheduler problem. The 40 ms minimum
geometry-start interval delays same-pack commits to roughly 25 ms and retained
revisits to roughly 32–33 ms even though those paths do little work. This makes
the intentionally retained path present at about 25–30 frames per second.

## Architectural consequence

The fixed 40 ms scheduler delay has now been removed. Geometry work remains
latest-only with at most one request in flight, so an input burst still skips
superseded work without imposing latency on the next useful render.

On the same benchmark machine, the corrected scheduler reduced median
same-pack commit latency to 0.9–1.6 ms and retained-revisit commit latency to
0.3–0.5 ms across the four cases. Median cold-pack commits remained 9.9–14.7
ms, with one horizontal p95 trial reaching 23.5 ms. This isolates the remaining
cache-miss problem from warm SVG navigation.

The verified compressed pack is now transferred to a persistent module worker
for gzip, UTF-8/JSON parsing, and structural/affine validation. With that worker,
the maximum animation-frame gap across these benchmark cases fell from 33.3 ms
to 17.6 ms. Median cold commits rose to 17–21.1 ms because the JSON representation
still requires a structured clone of the complete decoded pack back to the main
thread. This improves interaction continuity but confirms that a compact indexed
SVG response is needed to reduce both wait time and cross-thread allocation.

## Sparse indexed-SVG result

`anatomy-pack-v3` now exercises the accepted worker-owned indexed path against
the complete production display corpus. The corpus contains 407 display planes
(165 coronal, 142 sagittal, 100 horizontal) in 52 depth-eight packs. Its
compressed artifacts total 5,604,696 bytes, down 87.4% from the 44,424,303-byte
native v2 artifact inventory. Native 10 µm state and calibration are unchanged.

On the same benchmark class, five cache-busted trials produced:

| slice | paths | cold commit p50 | cold paint p50 | same-pack commit p50 | retained commit p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| coronal p95, 812 | 339 | 9.5 ms | 16.4 ms | 2.5 ms | 1.6 ms |
| sagittal p95, 606 | 199 | 9.3 ms | 16.4 ms | 2.2 ms | 1.4 ms |
| horizontal p95, 345 | 390 | 10.6 ms | 16.4 ms | 3.1 ms | 2.1 ms |
| horizontal maximum, 401 | 416 | 10.3 ms | 16.5 ms | 3.4 ms | 2.1 ms |

Median worker round-trip was 3.7–4.2 ms after module initialization. One first
trial paid a 32.7 ms worker/module startup cost; ordinary cache misses after the
initial three-view load did not. No long task was observed, and the largest
animation-frame gap was 17.6 ms. Compared with the JSON worker path's 17–21.1
ms median cold commits, returning one fragment removes the whole-pack clone and
cuts median cache-miss commit time to 9.3–10.6 ms.

The next production measurement is against the deployed origin with network
throttling and a visible wheel-burst scenario. That evidence should select any
prefetch-distance change; the current policy remains one adjacent pack during
idle time.

## Projection-pack-v1 retained-viewport rebaseline

Commit 5 moved the same validated sparse registered bytes behind the sole
schema-v1 projection-pack source and retained viewport. On 2026-08-22, five
cache-busted trials per case on Linux x64 (32 logical CPUs, headless Chromium
151) produced:

| slice | cold commit p50 | cold paint p50 | same-pack commit p50 | retained commit p50 |
| --- | ---: | ---: | ---: | ---: |
| coronal p95, 812 | 11.5 ms | 16.5 ms | 1.8 ms | 0.9 ms |
| sagittal p95, 606 | 10.0 ms | 16.5 ms | 1.4 ms | 0.6 ms |
| horizontal p95, 345 | 13.4 ms | 17.1 ms | 2.7 ms | 1.0 ms |
| horizontal maximum, 401 | 12.3 ms | 16.4 ms | 2.1 ms | 1.0 ms |

No long task was observed and the maximum animation-frame gap was 16.8 ms.
Every navigation retained the mounted viewport DOM and committed the requested
final display plane. Local Vite fetch timing is still not production-network
evidence; deployment-origin throttling remains the next measurement.

## Final five-view cutover rebaseline

Commit 8 re-ran the same benchmark after volume compositing, pointer
inspection, and the affine-free static-map viewports were integrated. On
2026-08-22, a second five-trial Linux x64/Chromium 151 run produced:

| slice | cold commit p50 | cold paint p50 | same-pack commit p50 | retained commit p50 |
| --- | ---: | ---: | ---: | ---: |
| coronal p95, 812 | 19.8 ms | 29.7 ms | 5.0 ms | 1.9 ms |
| sagittal p95, 606 | 24.9 ms | 28.6 ms | 8.4 ms | 2.1 ms |
| horizontal p95, 345 | 28.7 ms | 29.0 ms | 9.8 ms | 1.6 ms |
| horizontal maximum, 401 | 31.8 ms | 32.0 ms | 12.7 ms | 1.7 ms |

No long task was observed and the maximum animation-frame gap was 16.8 ms.
Cold preparation and uncached same-pack SVG parsing are slower than the
Commit-5-only viewport measurement, while retained revisits remain close to
one frame and below 2.1 ms to commit. This is an explicit optimization target,
not a launch-network result; production-origin throttling and a visible input
burst remain required before changing prefetch or cache policy.

The complete checked-in development projection pack occupies 5,616,902 bytes:
5,609,654 encoded bytes across registered resources, 749 encoded bytes across
the two static fragments, and a 6,499-byte manifest. Top is 197 bytes encoded
and 15,162 bytes decoded (114 paths); Swanson is 552 bytes encoded and 107,464
bytes decoded (808 paths). Both static fragments load independently and only
when their secondary tab is first opened. The final production build is
243.99 kB JavaScript (68.69 kB gzip), 65.08 kB CSS (11.86 kB gzip), and a
3.77 kB indexed-SVG worker, excluding scientific assets.
