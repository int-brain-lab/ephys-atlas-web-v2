# Status

Status: current immediate product priority; the contract-free domain foundation,
bounded visible-spatial session, synthetic adapters, and development-only UX lab
are implemented. The first task-based scientist review is next.

D058 accepts arbitrary feature scopes, release-owned z-score comparison, and
iterative Focus/Gallery/Profile UX over shared modular foundations. Q17 retains
the real normalization definitions. The first implementation work uses
synthetic fixtures and a development-only UX lab.

Current blockers: priority order only. Real-data normalization and immutable
comparison releases remain blocked on Q17, but generic machinery is not.

Implemented foundation:

- symbolic `all` and release-group scopes remain separate from resolved work;
- explicit selections reconcile to immutable release order without a feature-count cap;
- regional compatibility uses exact parcellation and volume compatibility uses
  exact `reference_space_id` independently of grid identity;
- incompatible explicit scopes fail closed, while stale active/pinned identities
  are removed deterministically across releases;
- z-score behavior is exercised only by explicit synthetic definitions.

Implemented application foundation:

- a comparison session separate from the ordinary single-feature session owns
  only the supplied visible feature window;
- bounded concurrency, request cancellation, stale-result rejection, partial
  failure, exact coordinate identity, and disposal are deterministic;
- a 4,345-feature symbolic scope can drive a small visible window without eager
  expansion into transport or rendering work.

Implemented UX lab:

- `just comparison-ux-lab` opens the development workbench at
  `/?lab=multi-feature`; it is excluded from production behavior;
- Focus, virtualized Gallery, and virtualized Profile share the comparison
  domain and bounded session rather than introducing product state or a new
  renderer facade;
- deterministic 5, 40, 100, and 4,345-feature scenarios cover responsive
  layout, filtering, pinning, multiple orientations, partial failure,
  missingness, zero variance, and compatible volumes on different grids;
- every scenario is visibly synthetic and uses the explicit
  `synthetic-comparison-z-v1` definition. It is not scientific release data.

Review goal: determine which composition helps scientists find similar spatial
patterns, inspect values at one coordinate, and retain a few features for close
comparison. Record changes to tile density, grouping/order, pinning, and the
Gallery/Profile relationship before integrating any lab composition into the
ordinary viewer.

Commits:

- Planning record: locate with
  `git log -1 -- docs/tasks/2026-09-02-multi-feature-comparison/STATUS.md`.
