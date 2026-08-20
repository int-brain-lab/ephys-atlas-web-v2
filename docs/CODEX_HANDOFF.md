# Local Codex handoff

This repository is ready to become the durable context for local Codex-based development once the handoff commit is green.

At handoff, GitHub has a single branch: `main`.

## Fresh local checkout

```bash
git clone https://github.com/rossant/ibl-ephys-atlas-web-v2.git
cd ibl-ephys-atlas-web-v2
git checkout main
git pull --ff-only origin main
just bootstrap
just check
```

Then start Codex from the repository root so it sees the root `AGENTS.md`.

If the checkout already exists:

```bash
git status
git checkout main
git pull --ff-only origin main
git fetch --prune
just check
```

Do not discard local changes shown by `git status`; reconcile them before pulling/starting autonomous work.

## What Codex should read

The root `AGENTS.md` already defines the required reading order. The essential durable context is:

- `AGENTS.md`
- `docs/LAUNCH_SPEC.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/AGENTIC_DEVELOPMENT.md`
- `docs/DECISIONS.md`
- `docs/INTEGRATION_STATUS.md`

There should be no need to provide the old ChatGPT Project conversations to a fresh agent.

## Suggested first Codex instruction

Use a task prompt along these lines:

> Read `AGENTS.md` and the active launch/implementation/open-question docs. Confirm `main` is clean and run `just check`. Then choose the earliest unblocked action in `docs/IMPLEMENTATION_PLAN.md`, implement the smallest coherent vertical slice, run targeted tests and `just check`, update durable status/decision docs if reality changed, and commit the completed green change directly on `main`. Do not invent answers to items in `docs/OPEN_QUESTIONS.md`.

The repository instructions, not this example prompt, remain authoritative.

## Recommended first product work after handoff

M1 (`ephys_atlas_channels`) has a pinned, deterministic real development build
and a green real-value browser acceptance suite. Its remaining blockers are the
paper vintage (Q2) and an authorized publication origin/catalog (Q8-Q9).

The earliest useful independent work is therefore M2 volume preparation that does **not** require guessing the scientific affine:

1. confirm the golden volume path remains green;
2. make the real-volume benchmark harness reproducible from a local canonical NPZ/source object;
3. benchmark candidate physical layouts/chunk sizes;
4. record metrics in `benchmarks/`;
5. do not select the production layout until the real evidence supports Q5;
6. do not publish scientifically aligned production volumes until Q4 is resolved authoritatively.

If the channel publication target or paper vintage is resolved first, finish
that release path before broadening scope.

## Private data and credentials

A clean checkout and `just check` must not require private S3/Alyx credentials.

Real-data builds/benchmarks may require locally configured IBL/ONE/S3 access. Keep credentials outside the repository. When a real-data task cannot run without them, the agent should:

- implement/test deterministic logic with local fixtures where possible;
- state the exact missing credential/source requirement;
- never fabricate production data or provenance.

## Completion discipline

For routine local development:

```bash
just check
git status
git diff
# commit only intended files once the gate is green
git commit -m "<completed behavior>"
git push origin main
```

Never push a knowingly red handoff commit. If CI exposes an environment-specific failure after a locally green push, stabilize `main` before starting the next independent feature.

## When to return to human/scientific input

Stop autonomous scientific-release work and request/consume authoritative input when a task reaches any unresolved **BLOCKER** in `docs/OPEN_QUESTIONS.md`.

Implementation agents may continue independent engineering work, but they must not turn an unresolved blocker into an implicit default.
