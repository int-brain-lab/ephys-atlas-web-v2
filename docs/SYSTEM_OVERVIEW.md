# System overview

Status: active system and documentation map.

IBL Ephys Atlas Web v2 turns pinned scientific inputs into validated,
immutable browser releases. Public exploration is designed to use static
object-storage reads; scientific transformation happens before publication,
never in the publishing service or browser.

## End-to-end flow

```text
canonical scientific source
    -> pinned source bytes and explicit scientific recipe
    -> dataset-specific Python builder
    -> shared deterministic schema-v1 serialization and validation
    -> immutable release plus provenance
    -> authorized publication to object storage/CDN
    -> catalog and mutable aliases outside immutable releases
    -> verified HTTP or local resource reader
    -> browser application session
    -> retained 2-D / optional 3-D rendering and UI
```

These boundaries are deliberate:

- A canonical scientific object is an input, not necessarily an efficient
  browser transport. A derived transport records provenance back to it.
- Builders perform scientific selection, transformation, aggregation, and
  deterministic release serialization. Publishing accepts already-built
  releases and performs no scientific transformation.
- Release directories are immutable. Catalogs and aliases may change, but
  they resolve to immutable release IDs outside those directories.
- Published HTTP and browser-local data use the same schema-v1 graph and
  materializers. IndexedDB changes transport, not scientific meaning.
- Synthetic fixtures prove contracts and behavior only. A validated real
  local release is still not a staging or published-production release.

## Product components

| Component | Responsibility | Primary authority |
| --- | --- | --- |
| Scientific sources and recipes | Pin source identity and make population, QC, transform, aggregation, and validity choices explicit | [`docs/data/README.md`](data/README.md) |
| Builders | Load dataset-specific sources and emit deterministic release graphs | `builder/` and dataset recipes |
| Release contract | Define manifests, feature representations, resources, statistics, volume geometry, and integrity | [`schema/v1/README.md`](../schema/v1/README.md) |
| Publishing | Stage, validate, publish, and manage aliases/catalogs with capability authorization | [`docs/publishing/API.md`](publishing/API.md) |
| Browser data layer | Validate and materialize the same contract through HTTP or local resource readers | `web/src/data/` |
| Application/domain | Own dataset lifecycle, state, URL history, cancellation, and presentation resolution | `web/src/application/`, `web/src/domain/`, and `web/src/core/` |
| Rendering | Maintain retained registered/static 2-D viewports and the optional sibling 3-D context | [`docs/rendering/README.md`](rendering/README.md) |
| UI | Compose accessible plain-DOM controls around application state | `web/src/ui/` |

## Scientific and rendering identity

Three identities must not be conflated:

- `reference_space_id` names the world coordinate frame and is the required
  equality before independently gridded anatomy and volume layers composite;
- grid identity includes shape, ordered axes, affine, index-center convention,
  and voxel-edge extent;
- asset, pack, and release IDs identify immutable encodings and do not prove
  scientific compatibility.

The launch 2-D workspace uses one ML/AP/DV world cursor on the native bilateral
10 µm Allen grid. Registered coronal, sagittal, and horizontal views compose
retained anatomy SVG and optional scalar-volume Canvas layers. Top and Swanson
are affine-free static regional SVG views. The optional retained 3-D anatomy
context shares regional presentation and selection state but does not render
encoding volumes or replace the launch-critical linked 2-D workspace.

## Artifact maturity

Keep implementation and scientific maturity separate:

| Maturity | Meaning |
| --- | --- |
| Synthetic/test-only | Deterministic contract or browser fixture with no scientific claim |
| Validated-real-local | Built from pinned real inputs and validated locally, but not remotely staged or published |
| Staging | Deployed to an authorized non-production origin for delivery and browser evidence |
| Published-production | Immutable public bytes and catalog entries approved for production use |

## Documentation authority

Different documents answer different questions; there is no single universal
precedence order.

| Question | Authority |
| --- | --- |
| What must launch? | [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) |
| What is the system and how does data flow? | This overview and [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What policy or product choice is accepted? | Effective index and historical bodies in [`DECISIONS.md`](DECISIONS.md) |
| What is implemented now? | Code/tests, summarized by [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md) |
| What should be done next? | [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) and its linked focused runbook |
| What must an agent not choose? | [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) |
| What is the scientific source and recipe? | [`data/README.md`](data/README.md), dataset recipes, and selection artifacts |
| What is the wire/release contract? | [`schema/v1/README.md`](../schema/v1/README.md) and `schema/v1/` |
| Why was a candidate accepted or rejected? | Frozen decision, audit, benchmark, or review evidence |
| How is an operational task performed? | A document explicitly labelled as a runbook |

Focused documents use these status concepts: `active`, `accepted`, `blocked`,
`runbook`, `frozen evidence`, `superseded`, and `retired`. Artifact maturity is
recorded separately and must never be inferred from a document's status.

## Current execution boundary

The active unresolved scientific and deployment choices are Q2 (paper channel
vintage), Q5 (production volume transport confirmation), the unresolved part
of Q8 (deployment names and topology), Q9 (paper aliases/defaults), and the
unresolved part of Q14 (additional audited scale/domain selections). Agents may
implement and test independent machinery, but must not choose these answers.

Use [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the exact next
testable actions and [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) for their stop
conditions.
