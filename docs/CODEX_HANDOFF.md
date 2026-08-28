# Local Codex handoff

Status: runbook for clean-checkout setup.

This repository is the durable context for local Codex-based development.
This file is the fresh-checkout/session runbook; current product priority and
status live in `docs/IMPLEMENTATION_PLAN.md` and
`docs/INTEGRATION_STATUS.md`.

At handoff, GitHub has a single branch: `main`.

## Fresh local checkout

Install `uv` 0.12+, Node 22, and `just` first. The committed `.node-version`
and npm engine constraint make the Node major explicit. Repository Python setup and
execution use only the committed uv lockfiles; no system `pip` installation is
required.

```bash
git clone https://github.com/int-brain-lab/ephys-atlas-web-v2.git
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
- `docs/SYSTEM_OVERVIEW.md`
- `docs/LAUNCH_SPEC.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/OPEN_QUESTIONS.md`

Then use the overview to select only the relevant architecture, effective
decisions, status, schema, source, and focused runbook documents. Use
`docs/AGENTIC_DEVELOPMENT.md` for the work loop.

There should be no need to provide the old ChatGPT Project conversations to a fresh agent.

On macOS, follow `docs/MACOS_DEVELOPMENT.md`. For the current production-volume
task, also read `docs/data/VOLUME_IMPLEMENTATION_HANDOFF.md` before acquiring
private inputs or generating artifacts.

## Suggested first Codex instruction

Use a task prompt along these lines:

> Read `AGENTS.md` and the active launch/implementation/open-question docs. Confirm `main` is clean and run `just check`. Then choose the earliest unblocked action in `docs/IMPLEMENTATION_PLAN.md`, implement the smallest coherent vertical slice, run targeted tests and `just check`, update durable status/decision docs if reality changed, and commit the completed green change directly on `main`. Do not invent answers to items in `docs/OPEN_QUESTIONS.md`.

The repository instructions, not this example prompt, remain authoritative.

## Product task selection after handoff

Choose the earliest unblocked, testable action in
`docs/IMPLEMENTATION_PLAN.md`. That plan is the only product-priority queue;
this handoff intentionally does not duplicate it. If an action reaches an
unresolved item in `docs/OPEN_QUESTIONS.md`, leave the scientific choice open
and continue with the next independent action permitted by the plan.

## Historical 3-D lab exception

The isolated P3D experiment is complete and frozen at the donor commit recorded
in `docs/rendering/3D_EVALUATION.md`. D042 records the selected GLB-derived
result. A fresh checkout does not need the donor branch or its ignored artifact
to continue M2 volume work. Do not resume annotation-derived mesh generation.

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
