# AGEA selected-region distributions

Status: superseded pre-D078 implementation plan.

This document preserves the proposal that preceded D078. It is not current
scientific or implementation authority: D078 and
[`VOLUME_REGIONAL_DISTRIBUTION_SELECTION.json`](VOLUME_REGIONAL_DISTRIBUTION_SELECTION.json)
resolve the source, registration, exact signed hemisphere rows, hierarchy and
unlabelled-voxel policies, while
[`VOLUME_REGIONAL_DISTRIBUTION_REVIEW.md`](VOLUME_REGIONAL_DISTRIBUTION_REVIEW.md)
records the implemented AGEA/W26 companion-matrix design and candidate evidence.
Q19 now retains publication promotion only. The sections below are kept as the
historical plan and should not be used to reopen those accepted choices.

## Objective

Make AGEA region selection visibly useful in the distribution UI without
changing the meaning of **Global distribution**. The global curve continues to
describe every valid voxel in the active experiment. Selecting a region from a
brain view or the Regions panel adds a separately identified, normalized curve
for the voxels assigned to that region and exposes the same result in **Compare
selected regions**.

This is a new volume-analysis capability. The current schema-v1 volume contract
contains global valid-voxel histograms only, and the current AGEA release does
not imply regional gene aggregation.

## Invariants

- Never replace or filter the global curve after region selection. Overlay or
  compare selected-region curves against it.
- Use the active release's exact histogram edges, bin rule, underflow and
  overflow semantics. Do not derive new edges or re-bin global counts in the
  browser.
- Apply the experiment's existing validity recipe first. Region membership
  partitions or selects valid voxels; it must not silently turn measured
  label-zero voxels into missing or outside voxels.
- Treat the region-membership grid as scientific release data with an exact
  source, shape, affine, `reference_space_id`, byte size and SHA-256. Top and
  Swanson SVG geometry is affine-free display geometry and must never be used
  to infer voxel membership.
- Keep the capability generic within schema v1. Do not add an AGEA-only reader,
  shadow schema, renderer facade or browser fallback.
- Preserve URL-persisted selection, coloring and navigation behavior. A region
  selected from any supported view and the same region selected from the tree
  must produce the same analysis population.

## Scientific decisions required before a real release

Record the accepted answers in a decision and hash-bound selection artifact:

1. **Label authority:** choose the pinned AGEA `label.npy` modal-label grid or
   another explicitly derived and validated label grid. The coverage lab's
   signed int32 label resource is evidence and prototype material, not release
   authorization.
2. **Registration:** accept the membership grid's mapping into the release's
   declared reference space. Visual agreement with a CCF-derived image is not
   independent biological-registration evidence.
3. **Hemisphere semantics:** decide whether the existing canonical folded
   region selection includes voxels from both physical hemispheres or whether
   a side-aware product change is required. Do not infer this from a signed ID.
4. **Hierarchy semantics:** decide whether selecting an ontology node includes
   only voxels with that exact label or also voxels labelled with descendants.
   Define behavior for navigation-only container nodes.
5. **Unlabelled and boundary voxels:** retain them in the global valid
   population under the current recipe, but decide and disclose whether they
   can enter any selected-region population. Define empty-region behavior.

These choices extend Q19 for region-conditioned analysis. They are independent
of the mechanical ability to compute a histogram.

## Recommended implementation

### 1. Prove the analysis with the existing lab data

Extend the synthetic/unit path around the coverage lab's signed int32
region-label volume. Implement a pure function that accepts expression values,
the validity mask, region labels, resolved histogram edges and selected region
identities, and returns exact counts and tails per selection. Keep this stage
explicitly exploratory until the decisions above are accepted.

The AGEA grid contains 159,326 voxels, so scanning the active decoded experiment
on selection is preferable to precomputing every experiment-by-region
histogram. Measure this assumption rather than setting a performance claim from
the grid size alone.

### 2. Add one shared schema-v1 membership resource

Define an optional, release-scoped volume-region-membership contract reusable
by all features on the same grid. It should declare:

- parcellation and region-ID domain;
- typed label resource and invalid/unlabelled sentinel;
- grid identity, axes, shape, affine and `reference_space_id`;
- membership, hemisphere and hierarchy policies;
- source and derivation provenance.

Place the resource once per compatible release/grid, not once per AGEA
experiment. Update the JSON schemas, Python and TypeScript validators, shared
valid/invalid contract fixtures, builders, HTTP/local materializers and graph
validation in one coherent schema-v1 change. Existing immutable releases remain
valid and retain global-only behavior when the optional capability is absent.

### 3. Compute selected curves off the rendering boundary

Load and integrity-check the shared membership resource through the normal
resource-reader path. Reuse decoded expression data through an
application/data-layer analysis boundary rather than reaching into a Canvas or
`ProjectionViewport` implementation. Run aggregation in a worker if measured
interaction latency or main-thread blocking warrants it.

Cache results by immutable feature/resource identity, resolved distribution
binning and region-membership policy. Cancel or discard stale work when the
experiment, release, distribution scale/domain or selection changes.

For each selected region, report:

- matched valid-voxel count;
- exact bin, underflow and overflow counts using the global edges;
- probabilities normalized by that region's matched count;
- an explicit unavailable/empty result when no valid voxel matches.

Overlapping parent/child selections may have overlapping populations if the
accepted hierarchy policy is descendant-inclusive; the UI and export must not
present those curves as independent samples.

### 4. Integrate with the existing comparison UI

Retain the global area and add selected-region curves with the existing stable
selection colors. Enable **Compare selected regions** for a volume only when
the active release declares compatible regional membership. Label counts as
valid voxels, not observations, and disclose the parcellation and membership
policy. Extend comparison export with the exact edges, counts, tails,
denominators and membership provenance.

When the optional capability is absent, keep the current explicit
"Selected-region distributions are unavailable for voxel volumes" state.

## Verification

- Pure deterministic tests for exact-label and descendant-inclusive fixtures,
  folded/side-aware identities, missing and measured-zero values, label zero,
  empty selections, overlapping selections, endpoints and focused tails.
- Shared Python/TypeScript schema fixtures for resource integrity, incompatible
  grids/reference spaces, invalid labels and incomplete policy metadata.
- Builder tests proving deterministic label bytes, provenance and reuse across
  all experiment features.
- Browser coverage selecting the same region from Top and the Regions panel,
  confirming that the global counts remain constant while the selected curve
  and comparison counts update identically.
- Browser coverage for rapid experiment/selection changes, cancellation,
  corruption recovery, local import and releases without the optional
  capability.
- Real-data Chromium and Firefox measurements for first label load, selection
  latency, worker/main-thread time, retained memory and repeated-selection cache
  behavior. Add native-Safari evidence before broad local-import claims.
- Run targeted Python, TypeScript and Playwright suites, then `just check`.

## Delivery slices and estimate

1. Exploratory prototype using the existing coverage-lab labels: 1–2 developer
   days; no scientific release claim.
2. Generic schema/materializer/builder capability and deterministic tests: 2–4
   developer days after policy approval.
3. UI, export, cancellation and browser coverage: 2–3 developer days.
4. Real candidate build, benchmarks, scientific review and production
   preflight: additional elapsed time driven by review and release operations.

The engineering estimate is approximately 4–7 developer days after the
scientific policy is fixed, or about 1–2 weeks for a release-quality vertical
slice. It excludes waiting time for Q19 review and any broader redesign of
side-aware region selection.

## Completion condition

The task is complete only when an accepted membership selection is recorded, a
new immutable AGEA release declares the generic capability and provenance, Top
and Regions-panel selection produce identical selected-region distributions,
the global distribution remains invariant, exports disclose the population,
real-browser evidence is recorded, and `just check` passes on clean `main`.
