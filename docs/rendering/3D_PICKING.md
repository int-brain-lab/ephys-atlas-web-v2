# 3-D picking and hover latency

Status: implemented on `main`, 2026-10-05. Applies to the retained native and
rollback viewports without changing mesh packs or scientific geometry.

## Picking index

`ComponentMeshPicker` owns CPU-only geometry wrappers for the decoded component
ranges. Each wrapper shares the render mesh's immutable attributes and index,
has its own triangle draw range, and has tight bounds around the original
component vertices. The wrappers never enter the GPU scene or add uploads.

At query time, each wrapper's world matrix combines the render mesh transform
with the component's declared explode translation. Three.js rejects component
bounds before testing their exact triangles. This also removes the old temporary
explode vector allocation for each visited vertex. The index is built once per
LOD, reused for hover, selection, camera and explode changes, and disposed with
its viewport or replacement LOD. Render buffers and materials retain their
existing ownership.

All intersections remain sorted by world distance. The viewport skips hidden
or unmapped surfaces before accepting the nearest eligible hit, including when
several intersections belong to one component. Barycentric interpolation uses
the original positions and the shared original-ML presentation rule; explode
does not change hemisphere identity. Visible translucent context stays pickable.

## Hover identity

A 3-D hover keeps its signed physical region ID through the application and
shared regional presentation. The 3-D lookup highlights that exact hemisphere,
including when the pointer crosses between two sides of the same region.
The regional tree and feature charts receive the folded logical ID; selection
still expands that logical region bilaterally. Linked 2-D projection hover
emphasis retains its existing bilateral expansion. Leave clears the shared
highlight. This fixes the former right-to-left hover folding at the application
boundary and presentation resolver.

## Hover scheduling

The first pointer move schedules a pick after 32 ms. Further movement replaces
the pending pointer event without resetting that timer. Sustained motion
therefore receives updates while moving; a synchronous burst still coalesces
into one query using its latest position. This is a scheduling interval, not a
hard latency guarantee on a busy main thread.

Camera drags suppress hover picking. Pointer down, click, leave, deactivation,
and destruction cancel queued hover work; clicks retain immediate picking.

## Evidence and limits

The real D070 model contains 966,645 triangles in 1,140 components. An
interleaved Chromium/Linux CPU comparison reconstructed the previous full-mesh
picker and compared 135 rays at three camera angles and explode 0, 0.5 and 1.
All returned region IDs matched, including 123 hits and 12 misses.

| CPU query | Median | p95 | Maximum sample |
| --- | ---: | ---: | ---: |
| Previous full-mesh picker | 55.7 ms | 59.1 ms | 84.0 ms |
| Component bounds and translation | 2.6 ms | 5.1 ms | 7.4 ms |

These are one instrumented host's samples, not a universal performance bound.
The uninstrumented first audit measured the old picker around 38 ms; avoid
mixing those separate runs into a speedup claim. The component result does not
currently justify adding a triangle BVH dependency. Reconsider it if measured
large-component queries become a bottleneck.

In a real-site hover probe, first application feedback arrived in 39–43 ms,
both with and without selected translucent context. Forty pointer moves
produced 21–22 picks during motion. Previously, a roughly one-second stream
produced one pick after movement stopped and application feedback around
1.15 seconds after the first move.

Application feedback timings exclude physical display presentation. This
headless host uses software rendering; native macOS input-to-visible-highlight
latency and hardware GPU timing still need manual confirmation. The existing
weighted transparency renderer is unchanged.

Deterministic unit tests compare exact hit distances, faces and barycentrics
against full-mesh raycasting, including transformed meshes, original ML zero,
hidden-hit fallthrough, bounds rejection and disposal ownership. Browser tests
cover sustained hover, burst coalescing, drag suppression, signed picking,
exploded original-side rendering, selection transparency and viewport lifecycle.
