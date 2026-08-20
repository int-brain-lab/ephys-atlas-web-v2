# Agentic development workflow

This document defines how a local coding agent should work in this repository after the ChatGPT-project bootstrap phase.

The objective is not maximum code throughput. It is continuous, reviewable progress on one integrated `main` branch while protecting scientific correctness and keeping the repository runnable.

## Operating model

- `main` is the development branch and source of truth.
- Work in small coherent units that can be validated and committed independently.
- Prefer the next unblocked acceptance criterion over speculative architecture work.
- Repository files, tests, schemas, source evidence, and recorded decisions outrank conversation memory.
- If durable repository documentation is stale, fix it as part of the task.

## Session startup

At the start of a local Codex session:

1. inspect `git status` and do not overwrite unrelated local work;
2. update from remote `main` without rewriting shared history;
3. read `AGENTS.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/OPEN_QUESTIONS.md`;
4. run `just check` or establish why the existing baseline is red before making product changes;
5. inspect the code/tests relevant to the selected task rather than coding from the specification alone.

If the checkout starts red, stabilization takes precedence over new features unless the failure is a known external/infrastructure issue documented in the repository.

## Choosing work

Select work from the earliest active milestone in `docs/IMPLEMENTATION_PLAN.md` that has an unblocked, testable next action.

A good autonomous task has:

- a clear acceptance condition from `docs/LAUNCH_SPEC.md` or an existing test contract;
- no unresolved scientific choice that the agent would need to invent;
- a bounded change surface;
- a way to verify behavior locally.

If a task becomes blocked by missing scientific or operational information, add/update `docs/OPEN_QUESTIONS.md` with the exact blocker and move to an independent task. Do not bury guessed defaults in code.

## Implementation loop

For each task:

1. **Inspect** — read the current implementation, tests, schema, and relevant decision/source docs.
2. **State the invariant** — identify what must remain true after the change (schema compatibility, coordinate semantics, immutable provenance, URL state, etc.).
3. **Add/adjust a failing test when practical** — especially for parsing, transforms, data contracts, and user-visible browser behavior.
4. **Implement the smallest coherent change** — avoid building abstractions with no immediate consumer.
5. **Run targeted tests** — use the narrowest test loop while iterating.
6. **Run the full gate** — `just check` before considering the task complete.
7. **Inspect the diff** — confirm only intended files changed; remove diagnostics, generated junk, and dead experiments.
8. **Update durable context** — status, decisions, plan, or open questions when the repository reality changed.
9. **Commit** — use a concise message describing the completed behavior, not the activity.

Do not weaken tests, TypeScript strictness, schema validation, scientific metadata, or error handling merely to make the gate pass.

## Test strategy

### Python / builder

Use deterministic synthetic inputs for transformation logic. Tests should cover:

- reproducibility/determinism;
- schema validity;
- binary dtype/shape/order;
- provenance fields;
- explicit failure when required scientific choices are missing;
- source snapshot identity where practical.

Never make tests depend on private S3/network access unless they are clearly separate integration tests.

### Frontend unit tests

Use them for:

- parsers/validators;
- URL state;
- scalar/color transforms;
- regional statistics materialization;
- volume chunk/slice mapping;
- coordinate transforms and layout-independent logic.

### Browser tests

Use Playwright for user-observable contracts:

- responsive composition;
- feature/representation switching;
- linked slices and URL state;
- region search/selection;
- histogram/comparison behavior;
- volume rendering path;
- failure/error states.

Mock the very large curated SVG HTTP assets with inventory-correct bundles unless a test specifically validates the deployed bytes/origin.

Do not assert fragile presentation details when a semantic selector/state assertion is available.

## Browser visual review

For layout or visual-renderer changes:

- inspect real browser output at representative desktop/tablet/phone sizes;
- keep existing approved screenshot/semantic contracts unless the product spec deliberately changes;
- when changing a visual contract, record why and update tests/screenshots in the same task.

Do not use visual similarity as a substitute for scientific coordinate/transform tests.

## Scientific data workflow

The builder should separate:

1. canonical source acquisition/pinning;
2. explicit scientific recipe selection;
3. deterministic transformation/aggregation;
4. schema-v0.1 packaging;
5. validation;
6. publication/deployment.

A local agent may implement steps 3-5 against synthetic or already-pinned inputs while steps 1-2 are blocked, but it must not fabricate a scientific release.

For real releases, record the exact source vintage/object, relevant source hashes, builder command/version, population/QC recipe, feature mode, and other scientific choices in provenance.

## Volume workflow

Keep three questions separate:

- **scientific geometry** — authoritative shape/axis order/affine/outside semantics;
- **canonical source object** — the producer's scientific artifact;
- **browser physical transport** — chunk/slice-pack representation selected by benchmark.

A benchmark may compare transports before the authoritative affine is resolved, but a production volume must not claim scientific coordinate alignment without Q4 in `OPEN_QUESTIONS.md` being resolved.

## Dependencies and architecture

Before adding a dependency, ask whether the existing platform/library can solve the problem simply.

- Keep the frontend framework-free unless an explicit decision changes D002.
- Preserve the `SliceRenderer` application boundary.
- Do not create a second schema for local data, publishing, or a specific renderer.
- Do not make publishing responsible for scientific transformation.
- Keep production data/asset URLs configurable or catalog-driven rather than embedding temporary environments throughout UI code.

## Debugging and temporary instrumentation

Temporary diagnostics are allowed while isolating failures, including CI-only diagnostics when logs are unavailable. Before the completion commit:

- remove global debug hooks;
- remove diagnostic-only tests/status names unless they provide ongoing value;
- keep only stable observability that helps future failures;
- rerun the clean gate.

## Documentation discipline

Use documents for different purposes:

- `LAUNCH_SPEC.md` — what must be true at launch;
- `IMPLEMENTATION_PLAN.md` — ordered execution state;
- `OPEN_QUESTIONS.md` — choices the agent must not invent;
- `DECISIONS.md` — accepted architectural/product decisions;
- `INTEGRATION_STATUS.md` — factual current implementation state;
- focused handoff/reference docs — supporting detail/evidence.

Do not turn `AGENTS.md` into a changelog. Do not leave newly accepted decisions only in commit messages or chat.

## Commit and handoff quality bar

A good completion commit has:

- one understandable purpose;
- relevant tests;
- no hidden scientific assumption;
- no unrelated formatting churn;
- `just check` green;
- documentation updated if behavior/contracts/status changed.

At the end of an autonomous session, another fresh agent should be able to read the repo and determine:

- what is implemented;
- what remains;
- what is blocked;
- why key choices were made;
- what the next unblocked task is;
- which command proves the current baseline is healthy.

That is the handoff standard.