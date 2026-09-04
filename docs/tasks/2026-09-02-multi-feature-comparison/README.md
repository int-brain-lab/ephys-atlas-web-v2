# Flexible multi-feature comparison

Status: active implementation; this is the current immediate priority in
`docs/IMPLEMENTATION_PLAN.md`.

## Outcome

Scientists can compare an arbitrary, immutable-release-ordered feature scope
at one shared anatomical cursor. The product scales through three coordinated
views rather than stretching one layout across every feature count:

- **Focus** presents a few large spatial maps for careful comparison;
- **Gallery** virtualizes tens or hundreds of smaller spatial maps;
- **Profile** presents all compatible feature z-scores at one or more selected
  regions or voxels.

The exact composition must be iterated with working scientists. These views are
replaceable UI compositions over stable domain, application, data, and
rendering boundaries.

## Accepted foundations

- A comparison belongs initially to one exact dataset and immutable release.
- Its feature scope is `all`, a release-owned group, or an arbitrary explicit
  ordered selection; no three-feature limit belongs in domain or schema state.
- Canonical feature order comes from the immutable release. Search/filtering
  preserves relative order. Alternate discovery sorting is explicit.
- Comparison colors encode release-owned z-scores through one shared symmetric
  scale. Native values and units remain visible as supporting detail and in the
  ordinary single-feature workspace.
- Q17 retains real normalization population, transform, weighting, validity,
  parcellation, zero-variance, and parameter selections. Synthetic fixtures
  may exercise the machinery with explicit synthetic parameters.
- One ML/AP/DV cursor remains the navigation authority. Each compatible volume
  maps it through its own declared affine.
- Regional spatial comparison requires the same parcellation. Volume spatial
  comparison requires exact `reference_space_id` equality but not identical
  grid shape, resolution, or affine.
- Regional and volume samples are not mixed in one spatial comparison without
  a future explicit sampling decision.
- `ProjectionViewportFactory` remains the retained renderer boundary. Do not
  add another renderer facade or fork application state.

## Modular architecture

### Domain

Add pure comparison state and reducers for feature scope, mode, orientation,
active/pinned features, normalization identity, and compatible representation.
Keep the world cursor and region selection in their existing shared state.
Reconcile comparison deterministically when dataset, release, representation,
or parcellation changes. Test scopes of 3, 20, 100, and 4,345 features.

### Application

Add a comparison session distinct from the ordinary single-feature session.
It owns request generations, cancellation, visible-tile scheduling, atomic
coordinate commits, partial failure, byte/memory budgets, and disposal. It
turns symbolic scopes into bounded visible work instead of expanding `all`
into thousands of eager loads.

### Data

Expose intent-oriented ports for feature metadata, visible spatial planes, and
profiles at regions/voxels. Adapters may initially compose existing per-feature
HTTP or local resources. The UI must not know whether a request uses individual
features, a regional matrix, or a location-oriented volume chunk.

Measure real requests before adding optimized artifacts. A later justified
transport may provide feature-by-region matrices or spatial chunks containing
many feature values. Such a change updates schema v1, all producers and
validators, HTTP/local readers, fixtures, and consumers coherently and records
full integrity and provenance.

### Rendering and UI

Instantiate keyed retained viewports through `ProjectionViewportFactory` and
virtualize Gallery tiles so only visible maps own resources. Keep Focus,
Gallery, Profile, feature-scope controls, common legend, tile detail, and the
pinned-feature tray separable. Tile count, column count, drawer state, and
scroll position are presentation preferences rather than scientific state.

Coordinate durable comparison URL fields with D056/D061. Persist exact dataset and
release, edition/custom context, symbolic or explicit feature scope, mode,
orientation, cursor, normalization identity, and bounded pinned selections.
Do not put thousands of expanded feature IDs into a share URL.

## Delivery and scientist-review sequence

### 1. Contract-free foundation

Implement pure comparison state, compatibility resolution, canonical ordering,
and synthetic normalization definitions. Keep this independent of DOM,
transport layout, and viewport count.

### 2. Application/data seams

Implement the comparison session and synthetic/in-memory port adapters. Prove
bounded visible work, cancellation, stale-result rejection, atomic coordinate
identity, and disposal before building the final UI.

### 3. Development-only UX lab

Provide deterministic scenarios with 5 regional, 40 volume, 100 synthetic,
and 4,345 AGEA-like features, plus missing, zero-variance, slow, failed,
incompatible, and different-compatible-grid cases. Exercise Focus, Gallery,
Profile, feature filtering/grouping, pinning, and responsive compositions.

Implemented on `main`. Run `just comparison-ux-lab`; Vite opens
`/?lab=multi-feature` (normally on `http://localhost:5173`). The workbench is
available only in Vite development mode and is clearly marked as synthetic.
It does not read or publish scientific releases.

### 4. First scientist review

Use task-based sessions: find similar patterns, identify unusual features at a
location, compare known feature sets across slices, find a gene, return to
single-feature detail, and explain the z-score encoding. Record whether tile
sizes, canonical groups/order, hover versus click, pinning, alternate sorting,
and Profile/Gallery composition support real work.

For a review session, ask the participant to move among the 5-, 40-, 100-, and
4,345-feature scenarios rather than treating the lab as a finished design.
Have them filter a large scope, scan Gallery, pin candidates into Focus, inspect
Profile at the shared coordinate, change orientation, and explain what the
common z-score encoding means. Use the failure scenario last to check whether
missing, zero-variance, delayed, failed, and incompatible data remain legible.

### 5. Regional vertical slice

Integrate a virtualized regional Gallery, selected-region Profile, Focus
pinning, shared hover/selection, accessibility, and responsive behavior. Use
synthetic z-score parameters until Q17 is resolved. Add deterministic unit and
Playwright coverage.

### 6. Volume Focus and Gallery

Use existing per-feature resources first. Load only visible/pinned planes,
deduplicate anatomy, cancel superseded navigation, preserve exact cursor
identity, and expose each tile's missing/outside/failure state. Benchmark 10,
40, and 100-feature scopes for requests, bytes, latency, memory, canvas count,
and interaction responsiveness.

### 7. Second scientist review with validated-real-local releases

Evaluate real spatial usefulness, grouping and labels, common z-score ranges,
partial loading, selected-location comparison, and transitions among Profile,
Gallery, Focus, and ordinary single-feature exploration. Change UI composition
without weakening the stable boundaries.

### 8. Optimized profile transport if evidence requires it

Design location-oriented regional/volume resources from measured access
patterns, especially for AGEA-scale profiles. Build deterministic integrity,
provenance, HTTP/local parity, cache, and corruption evidence. Preserve normal
feature-oriented resources for single-feature spatial exploration.

### 9. Real z-score selections

After Q17 review, record versioned normalization selections and build new
immutable releases. Apply the exact same z-score and common-scale semantics to
spatial maps, profiles, legends, tooltips, and exports. Never infer a baseline
from runtime-loaded subsets.

### 10. Product integration and hardening

Promote only the reviewed composition, remove unsuccessful lab variants, add
URL/share behavior, enforce measured budgets, complete responsive/keyboard and
cross-browser coverage, run `just check`, and update decisions/status/evidence.

## Scientist-review questions

- At what feature count does spatial Gallery cease to be useful?
- Which canonical grouping and order reflect scientific workflows?
- Should hover preview or click/pin drive Profile changes?
- How many locations and large Focus maps are useful simultaneously?
- Is alternate sorting by z-score magnitude useful and sufficiently clear?
- Should Profile and Gallery coexist or be separate modes?
- Which details make the normalization population understandable?
- When, if ever, is a mixed regional/volume profile scientifically valid?

## Risks and stop conditions

- Z-scoring does not make different anatomical sampling semantics equivalent.
- Do not choose real normalization populations or parameters before Q17.
- Do not eagerly load all features represented by a symbolic scope.
- Do not add a bulk schema resource before benchmarks identify a real need.
- Do not let UX experiments fork the domain, application session, data
  contract, URL identity, or renderer boundary.
- Keep synthetic fixtures visibly synthetic and real local releases distinct
  from published scientific releases.
