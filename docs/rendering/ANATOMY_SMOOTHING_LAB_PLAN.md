# Anatomy smoothing and simplification lab plan

Status: **approved investigation lane; not implemented and not a production
geometry decision**.

This document is an execution plan for a standalone, local lab that compares
presentation-oriented smoothing and simplification of the active bilateral
10 µm Allen anatomy. It is deliberately detailed enough for an implementation
agent to follow without reconstructing the scientific and architectural
constraints.

The observed problem is visual: the active registered SVG paths follow exact
10 µm raster-cell edges, so diagonal and curved anatomical boundaries retain a
visible staircase when enlarged. The old website looked smoother because its
curated mesh-derived paths passed through RDP, Inkscape simplification, SVGO,
and manual processing. The current exact artifact instead guarantees IoU 1 and
zero boundary displacement. Neither result establishes the right compromise
for the production presentation asset.

## Outcome and stopping point

Build an ignored, fully offline HTML report in which a human reviewer can move
between representative coronal, sagittal, and horizontal slices and compare
the exact reference with several deterministic candidate strategies and
parameter values. The page must expose visual differences and measured
scientific/structural consequences together.

The investigation is complete when:

1. one reproducible command builds the lab from the pinned bilateral 10 µm
   source;
2. exact and candidate geometry can be compared side by side, overlaid,
   blinked, and inspected per region;
3. every candidate reports topology, coverage, component/hole, adjacency,
   source-voxel, IoU, boundary-error, size, and complexity results;
4. rejected candidates remain visible and are clearly labelled with every
   failed gate;
5. deterministic tests cover strategy execution, metrics, serialization, and
   the offline report;
6. a separate full-corpus command can evaluate a shortlisted configuration
   across all 3,260 native slices without creating a release; and
7. the reviewer records either a shortlist for a subsequent immutable-pack
   proposal or a decision to retain exact geometry.

Stop at evidence and a recorded recommendation. Do not replace the active
anatomy or projection pack in this lane.

## Non-negotiable boundaries

- The exact immutable parent
  `allen-ccfv3-10um-bilateral-exact-599b5e0bbab1` is the reference, not a
  candidate to overwrite.
- Validate the parent manifest and source hashes, and assert that regenerated
  exact paths for every sampled plane match the canonical parent fragments.
  Also record the active sparse-v3 and projection-pack identities/hashes so the
  report identifies exactly what the browser currently displays.
- Read the pinned annotation/LUT identity and projection transforms from the
  validated parent/build inputs. Do not introduce a new affine, orientation,
  atlas ID domain, hemisphere rule, or reference-space identity.
- Smoothing changes presentation geometry only. Native 10 µm cursor state,
  world coordinates, slice counts, sparse 80 µm display selection, and volume
  registration remain unchanged.
- Process the complete labelled plane as a coverage, or process each shared
  interface once and reuse it in both adjacent regions. Independently smoothing
  region rings is allowed only as an explicitly unsafe negative control; it
  must never appear as an eligible candidate.
- Keep exact geometry available beside every candidate. Browser antialiasing,
  CSS filters, rounded strokes, and screenshots are not scientific metrics.
- Do not mutate files under `web/public/`, regenerate an immutable pack, change
  `atlas-projection-pack-v1`, or add a runtime renderer mode.
- Lab output belongs under ignored `artifacts/`; it is not production data and
  must not be committed.
- A visually preferred result is not accepted until the existing full-corpus
  topology and coverage gates pass. The lab may report a candidate as
  structurally valid, but only a later explicit decision may set a production
  error/IoU budget and promote a new immutable artifact.

## Reuse and ownership

Use existing code rather than creating another geometry interpretation:

- `tools/anatomy_pack/build_v2.py` owns bilateral plane extraction, signed
  Allen/Beryl/Cosmos identities, and projection orientation.
- `tools/anatomy_pack/geometry.py` owns exact raster polygonization,
  coverage-safe GEOS simplification, validation, and SVG serialization.
- `tools/anatomy_compare/` is the UI/packaging precedent for a deterministic,
  self-contained report with no runtime network dependency.
- `docs/rendering/ANATOMY_COMPARISON.md` remains the historical 25 µm/legacy
  comparison record. Do not silently change its meaning or output schema.

Create `tools/anatomy_smoothing_lab/` for the new lab. Share small pure helpers
from the existing modules when their semantics already match; otherwise keep a
new strategy/report layer above the existing bilateral geometry functions.
Do not make the historical ring-by-ring RDP pilot look topology-safe by moving
it into the production geometry module.

## Experiment model

### Reference and sample selection

The MVP operates on a bounded sample so iteration stays practical. Defaults
must be deterministic and include all three projections. Select sample planes
from the active sparse display inventories, not by inventing new navigation
coordinates.

Include at least these stress categories, recording why each plane was chosen:

- a central, visually representative plane for every projection;
- high boundary-vertex or high region-count planes;
- planes with many junctions/adjacencies;
- planes containing small components and holes;
- a bilateral/midline case; and
- explicit CLI-provided native slice indices for reproducing a reported visual
  issue.

Derive automatic stress samples from measured exact-plane properties and use
stable lower-index tie breaking. Do not hardcode anatomical claims about which
slice is scientifically representative. The report must show native slice
index, world coordinate, sparse display membership, source hash, and view box.

### Strategy interface

Implement a small Python registry. A strategy receives the complete exact
labelled coverage plus an immutable parameter object and returns either a
label-to-geometry mapping or a structured generation failure. Every strategy
declares a stable ID, human label, algorithm/version, parameter schema, and
whether shared-edge topology is expected by construction.

Start with only the strategies needed to answer the immediate question:

1. `exact`: zero-displacement control using exact collinear vertex removal;
2. `geos-coverage-simplify`: the existing Shapely/GEOS whole-coverage path with
   physical tolerances supplied in micrometres; expose
   `simplify_boundary=True` and `False` as distinct parameter combinations so
   the reviewer can separate internal-border smoothing from movement of the
   outer brain silhouette;
3. `independent-ring-rdp-unsafe`: optional visual negative control reusing the
   old comparison lab, permanently labelled topology-unvalidated and excluded
   from shortlist/pass status.

Use a default exploratory tolerance sweep of `0,2.5,5,7.5,10,15,20` µm for
the 10 µm atlas. These are experiment inputs, not accepted budgets. The CLI must
allow an explicit list, canonicalize numeric values, reject negative/non-finite
values, and deduplicate values deterministically.

Do not implement splines, Bézier fitting, raster blurring, morphological
filters, or corner cutting in the MVP. Add one only through the same registry
after the baseline lab works, with a written hypothesis that it can outperform
coverage simplification and a validator capable of exposing crossings,
collapses, or label changes. A shared-chain strategy must anchor junctions and
plane-boundary contacts, transform each interface once, and reuse the reversed
chain for its neighbour.

### Result contract

Define and test an internal versioned report document such as
`ibl-anatomy-smoothing-lab-v1`. It is a lab contract, not a browser or release
schema. For each source plane and variant record:

- projection, native slice index, world coordinate, view box, source identity,
  resolution, strategy ID/version, and canonical parameters;
- success, generation failure, validation failures, and eligibility class
  (`reference`, `eligible`, `rejected`, or `unsafe-control`);
- deterministic SVG fragment with direct signed Allen/Beryl/Cosmos attributes;
- region/path/ring, component, hole, adjacency, and vertex counts before/after;
- coverage and individual-geometry validity;
- uncovered, multiply covered, and wrong-label source-voxel-centre counts;
- internal background components before/after;
- minimum eligible-region IoU plus the worst affected region identities;
- symmetric boundary-error median, p95, sampled maximum, and conservative
  upper bound in micrometres;
- per-region area-change summaries, including worst absolute and relative
  changes, so a global minimum IoU cannot hide a damaged small structure;
- post-serialization shared-edge/coverage results, so coordinate formatting or
  quantization cannot reintroduce a seam after in-memory validation;
- raw UTF-8, deterministic gzip-9, and optional Brotli sizes;
- generation/validation elapsed time as diagnostic evidence, clearly excluded
  from deterministic equality; and
- tool commit/dirty state plus Shapely and GEOS versions.

Keep the deterministic content separate from measured timing. A fixed
`--created-at` must produce byte-identical deterministic report data and HTML
on the same pinned environment. Dirty worktrees are allowed for lab iteration,
but the report must display that state prominently; evidence used for a final
recommendation must come from a clean commit.

The existing `simplify_coverage` helper raises on a failed gate. Refactor or
wrap it so the lab retains geometry and a complete structured validation result
for rejected variants. Production builders may continue to fail closed. Do not
parse exception prose into metrics.

## Lab webpage

Generate one self-contained HTML file with inline CSS, JavaScript, report JSON,
and SVG fragments. It must have a restrictive offline CSP and make no HTTP
requests. Follow the existing comparison lab's simple DOM approach; do not add
a frontend framework or runtime dependency.

Required controls and views:

- projection and sample/slice selectors;
- strategy and parameter selectors, with keyboard-accessible previous/next
  controls;
- exact and candidate side-by-side panels using the identical view box;
- overlay, boundary-only overlay, adjustable opacity, blink, and difference
  emphasis modes;
- pan/zoom or a magnified inspection inset so 10 µm stair steps can be reviewed
  without changing geometry;
- browser-only stroke visibility, width, line-join, and line-cap controls for
  diagnosing how much of the effect is presentation; these controls must be
  clearly separated from geometry strategies and receive no scientific badge;
- linked hover by signed Allen ID across panels with region ID/name when
  authoritative metadata is available;
- a persistent status badge for reference/eligible/rejected/unsafe and a list
  of all failed gates;
- a compact summary comparing vertices, encoded size, IoU, and boundary error;
- full per-slice metrics and a sortable worst-region table; and
- a provenance panel containing exact source, parameter, tool, and environment
  identities.

Provide JSON/CSV evidence export and a copyable reproduction command when this
can remain fully local. These exports describe the lab run and never constitute
a release artifact.

Never use fill color alone to distinguish exact from candidate. Use labelled
panels and distinct boundary dash/color treatment. Preserve actual SVG paths;
do not smooth them through Canvas interpolation. If a geometric symmetric-
difference overlay is expensive, begin with exact/candidate boundary overlays
and add a generated difference layer later.

The URL fragment may persist the selected projection, slice, strategy,
parameter, and mode for sharing a location within the local report. It is not
application URL state and must not import the viewer reducer/codec.

## Metric and gate policy

For each sample, compute metrics against the exact geometry produced from the
same label plane. A candidate is `eligible` only when all non-negotiable
structural gates pass:

- valid complete coverage and valid individual geometries;
- identical label set, component count, hole count, and adjacency graph;
- zero uncovered, multiply covered, or wrong-label source voxel centres;
- identical internal-background component count; and
- finite, complete metric output.

Show the existing anatomy-contract review values (eligible-region IoU 0.98,
area threshold 0.01 mm², and the chosen boundary-error input) as explicitly
labelled comparison gates. Do not silently declare them the correct production
budget for this new presentation choice. The lab CLI should require or clearly
display the provisional maximum-error and IoU values used to classify a run.

Full-corpus evaluation must aggregate worst slice and region identities, not
only global averages. It must fail nonzero when a shortlisted configuration
violates a configured gate, and write a deterministic machine-readable summary
plus a human-readable report. Sample success never implies corpus success.

## Implementation slices

Complete these in order, keeping each commit green and reviewable.

### Slice 1 — Pure experiment core

- Add the strategy registry and typed result objects under
  `tools/anatomy_smoothing_lab/`.
- Reuse exact bilateral plane extraction and coverage geometry.
- Separate candidate generation from validation so failed candidates retain
  structured evidence.
- Add deterministic synthetic label planes covering shared edges, T-junctions,
  checkerboards, holes, disconnected islands, background cavities, bilateral
  signed IDs, and plane-edge contact.
- Unit-test tolerance parsing, strategy identity, determinism, failure
  classification, and every structural metric.

Completion: focused Python tests pass without downloading the real atlas.

### Slice 2 — Deterministic report builder

- Add a CLI with explicit `--output`, `--created-at`, `--strategies`,
  `--tolerances-um`, optional per-projection slice lists, and offline/source
  controls consistent with the existing anatomy tooling.
- Validate the exact parent/source hashes before processing real planes.
- Implement deterministic automatic stress-sample selection and record its
  reasons.
- Serialize the versioned report document and inline it safely into a template,
  escaping `</script>` and rejecting undeclared external resources.
- Add a narrow canonical-reference test that regenerates selected planes and
  compares them with the checked-in exact-v2 bytes and active sparse inventory.
- Add `just anatomy-smoothing-lab` and include synthetic core/report tests in
  `just test-anatomy`.

Completion: two fixed runs from synthetic inputs are byte-identical, and a real
10 µm run writes only to ignored `artifacts/anatomy-smoothing-lab/`.

### Slice 3 — Interactive offline UI

- Implement the required selectors, comparison modes, linked hover, zoom,
  status/failure presentation, metric summary, worst-region table, and
  provenance panel.
- Keep rendering functions pure where practical and add stable semantic DOM
  attributes for testing.
- Add a browser smoke test against a tiny committed synthetic report fixture,
  or an equivalent deterministic DOM test if Playwright integration would pull
  the lab into the product build.
- Manually inspect representative desktop and tablet sizes and keyboard use.

Completion: the report remains useful with networking disabled and makes it
impossible to mistake a rejected or unsafe candidate for an accepted one.

### Slice 4 — Real sample review and shortlist

- Generate from a clean commit using the pinned 10 µm inputs.
- Review all default stress samples and additional user-reported slices at
  normal viewer scale and magnified scale.
- Record qualitative notes by projection and configuration alongside the
  quantitative table; do not encode aesthetic judgement as an automatic gate.
- Shortlist at most a few configurations. If none is consistently better,
  record that exact geometry remains preferred and stop.

Completion: commit a concise evidence summary and reproduction command, but
not the generated HTML or large geometry.

### Slice 5 — Full-corpus validation of the shortlist

- Stream all 1,320 coronal, 1,140 sagittal, and 800 horizontal native planes so
  peak memory is bounded.
- Run every existing v2 topology, coverage, source-voxel, signed-ID,
  synchronization, IoU, and boundary-error gate plus the new area-change
  summaries.
- Record worst cases and deterministic totals; optionally emit a second lab
  containing just the worst slices for human review.
- Measure candidate vertex counts, serialized/gzip sizes, generation time, and
  actual 407-slice sparse ISVG packaging size. Benchmark browser parse, render,
  and picking on representative viewport sizes and zoom levels; vertex
  reduction does not necessarily reduce gzip size once diagonal decimal
  coordinates are introduced. Do not build or publish a replacement pack.

Completion: one configuration has complete clean full-corpus evidence, or the
lane records why no candidate qualifies.

### Slice 6 — Separate promotion decision, only if requested

Promotion is a new task requiring repository-owner review. It must choose and
record the accepted physical error/IoU policy and define a new immutable
presentation-geometry derivative whose parent is the exact-v2 manifest. Do not
weaken or overwrite exact v2, which remains the scientific geometry and affine
authority. The new derivative needs its own format/identity, strategy and
parameter provenance, complete validation evidence, and sparse sampling; the
projection pack may then copy that new asset. Rerun every applicable parent,
sparse-pack, and projection-pack validator, derive rather than edit resources,
update all producer/consumer documentation coherently, compare browser
performance, run `just check`, and retain all old immutable artifacts as
reproducibility and rollback evidence. Record this cutover in a separate
decision before implementation because the current v3 contract explicitly
requires lossless extraction from exact v2.

## Expected files

The investigation implementation should normally be confined to:

- `tools/anatomy_smoothing_lab/__init__.py`;
- `tools/anatomy_smoothing_lab/strategies.py`;
- `tools/anatomy_smoothing_lab/metrics.py`;
- `tools/anatomy_smoothing_lab/build.py`;
- `tools/anatomy_smoothing_lab/template.html`;
- `tests/test_anatomy_smoothing_lab.py`;
- a tiny synthetic browser fixture/test only if required;
- `Justfile` command wiring; and
- this document plus a later evidence note/status update.

Changes to `tools/anatomy_pack/geometry.py` should be small extractions that
preserve current production-builder behavior and existing tests. Changes under
`web/src/`, projection-pack schemas, or active public assets are out of scope.

## Verification commands

During implementation, use:

```bash
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python -m pytest -q tests/test_anatomy_smoothing_lab.py
just test-anatomy
just anatomy-smoothing-lab
just check
```

The eventual lab command should accept explicit reproducibility inputs similar
to:

```bash
just anatomy-smoothing-lab \
  tolerances="0,2.5,5,7.5,10,15,20" \
  output="artifacts/anatomy-smoothing-lab/index.html"
```

Do not add the real 10 µm source, LUT, generated report, or full-corpus outputs
to Git. Before each commit inspect `git status`, commit only intended files,
and finish with `just check` green.

## Questions reserved for human review

The implementation agent must not decide these implicitly:

1. How much visible smoothing is preferable at normal and maximized viewer
   scales?
2. What physical boundary-error and region-area/IoU budgets are acceptable for
   presentation geometry derived from the exact 10 µm reference?
3. Is straight-segment coverage simplification sufficient, or does the review
   justify investigating a more complex shared-chain smoothing strategy?
4. Should one configuration apply to all projections, or is a per-projection
   policy scientifically and operationally acceptable?
5. Does the visual improvement justify a new immutable parent/projection pack
   and its deployment/cache migration cost?

Until those questions are answered from lab evidence, the current exact
registered geometry remains authoritative and active.
