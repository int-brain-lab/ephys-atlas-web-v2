# Anatomy navigation performance

## Reproducible browser instrumentation

Run the controlled cold-cache benchmark with:

```sh
just benchmark-anatomy
```

It launches an isolated headless Chromium rather than reusing a developer
browser. Each trial creates a fresh anatomy source, cache-busts the selected
pack request, and records:

- fetch and response-body read;
- SHA-256 verification;
- gzip decompression;
- UTF-8 decoding, JSON parsing, and pack validation;
- SVG-fragment serialization, SVG parsing, path indexing, DOM swap, regional
  state, and guides;
- input-to-DOM-commit and input-to-next-paint;
- long tasks, animation-frame gaps, heap delta, and final-slice correctness;
- a second uncached SVG in the same decoded pack and a retained-layer revisit.

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

The next implementation should:

1. move cold-pack decompression and validation off the main thread;
2. benchmark the indexed UTF-8 SVG pack in that worker path—the prototype can
   remove UTF-8/JSON object parsing, validation allocation, and fragment
   serialization, but gzip cost remains unless transport changes;
3. repeat this benchmark against the deployed origin with network throttling
   and a visible wheel-burst scenario before selecting prefetch distance.
