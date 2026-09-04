# Status

Status: current immediate product priority; the contract-free domain foundation
is implemented and the application/data seam is next.

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

Commits:

- Planning record: locate with
  `git log -1 -- docs/tasks/2026-09-02-multi-feature-comparison/STATUS.md`.
