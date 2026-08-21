# PR #4 integration runbook

Status: **active temporary runbook** for integrating GitHub PR #4 into the
single authoritative `main` branch.

This runbook supersedes the continuation priorities in
`docs/CODEX_REFACTOR_HANDOFF.md`. It is intentionally operational and must be
removed after integration is complete. Durable product priorities remain in
`docs/IMPLEMENTATION_PLAN.md`; scientific and operational choices remain in
`docs/OPEN_QUESTIONS.md`.

## Objective

Integrate the valuable architectural work from PR #4 without carrying forward
known regressions, transient branch instructions, or a second development
line. Finish with:

- one remote development branch: `main`;
- the tested PR commit stack incorporated into `main` without rewriting shared
  history;
- `just check` and GitHub Actions green on the final `main` commit;
- durable documentation describing the actual product and architecture;
- no active `work/*` or `agent/*` branch or PR-specific handoff document.

## Starting checkpoint

At the time this runbook was written:

- base repository: `rossant/ibl-ephys-atlas-web-v2`;
- PR: `#4`, `work/refactor-architecture` -> `main`;
- base commit: `d254c714d47b71f680734885e5205a68c4668cd0`;
- reviewed PR tip before this runbook: `a1ada50b07a26ada6e1e3fdd878f1b93ac9eee72`;
- relationship: PR is 21 commits ahead and 0 behind `main`;
- GitHub reports the PR mergeable with Python and web CI green;
- the PR remains draft and has no human review recorded.

Recheck every item before acting. If `main` has advanced, do not force-push,
reset, or assume the fast-forward procedure below still applies. Recompute the
merge base and adapt with an explicit, reviewable integration commit.

## Scope boundary

Freeze the architectural scope now. Do not add the proposed `app-shell.ts`
decomposition, rendering-directory reorganization, cache-policy redesign, or
other opportunistic refactors to PR #4.

Allowed work on the PR branch is limited to:

1. concrete correctness and integration fixes listed below;
2. tests for those fixes;
3. restoration of readable formatting where the PR compressed source;
4. reconciliation of durable documentation;
5. validation and integration bookkeeping.

Do not resolve scientific questions Q2, Q4-Q9, or Q11 by inference. The
refactor does not change their status.

## Agent coordination

The primary agent owns sequencing, final review, commits, pushes, integration,
and branch cleanup. Use subagents for bounded parallel audits and implementation
only when their file ownership does not overlap.

Recommended initial read-only subagents:

1. **Frontend lifecycle reviewer** — inspect `DatasetSession`, `AtlasApp`, URL
   migration, regional tree behavior, anatomy loading, and prefetch
   cancellation. Confirm the known hover and cancellation findings and look for
   additional observable regressions.
2. **Publishing/builder reviewer** — inspect request sizing, mutation locking,
   staging cleanup, client/CLI behavior, and shared channel/cluster regional
   serialization. Confirm limits against representative release inventories.
3. **Contracts/docs/CI reviewer** — inspect Python/TypeScript contract parity,
   architecture dependency tests, CI/runtime version alignment, formatting,
   and durable-document consistency.

Use high reasoning effort for the frontend and publishing reviews because they
cross asynchronous and persistence boundaries. A faster/lower-effort agent is
appropriate for mechanical documentation, formatting, and command-result
verification after the high-risk decisions are made.

Before allowing subagents to edit, assign disjoint path ownership. Agents must
not commit independently unless the primary agent explicitly assigns a whole
commit slice. The primary agent must inspect every diff and stage only the
intended paths.

## Phase 0 — refresh and verify the baseline

From a clean checkout:

```bash
git fetch origin
git switch work/refactor-architecture
git pull --ff-only
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
git merge-base origin/main HEAD
gh pr view 4 --repo rossant/ibl-ephys-atlas-web-v2 \
  --json state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,headRefOid
```

Expected relationship while `main` remains unchanged: a zero left count and at
least 22 commits on the right after the commit adding this runbook. The right
count increases with each forward fix. Record the actual base and tip SHAs in
the working notes.

Run `git diff --check origin/main...HEAD`. Stop and investigate any unexpected
worktree changes or remote divergence before editing.

## Phase 1 — publishing limits and CI runtime

### Required fix: realistic publication request sizing

The PR adds a 2 MiB default cap for every non-chunk request. Upload creation
sends the complete artifact inventory as JSON, while the publication store
supports as many as 100,000 artifacts. Representative production volume
layouts can approach or exceed the new cap before reaching the supported
artifact-count limit.

Determine the largest representative manifest from measured channel and volume
release inventories. Then choose and document one coherent solution:

- make the metadata-request limit explicitly configurable through the service
  and CLI/deployment entry points, with a safe production default derived from
  evidence; or
- redesign upload-manifest transport so large valid inventories do not require
  one bounded JSON request.

Do not simply remove request bounds. Add tests covering:

- rejection immediately above the configured limit;
- acceptance of a representative near-production artifact inventory;
- preservation of the separate binary-chunk limit;
- malformed or truncated `Content-Length` handling.

### Required fix: Python version coverage

The PR changes CI from Python 3.12 to 3.11, while the pinned scientific builder
environment and repository tooling use Python 3.12. Keep the CI cache and
combined installation improvements, but restore Python 3.12 coverage. Test
3.11 as an additional compatibility job only if maintaining both is an
intentional project decision.

### Review, test, and commit

Run at least:

```bash
just test-publishing
just test-builder
```

Suggested commit:

```text
Align publishing limits with release inventories
```

The CI runtime correction may be included when it is part of the same verified
gate alignment, or committed separately as `Restore Python 3.12 CI coverage`.

## Phase 2 — frontend lifecycle regressions

### Required fix: stale hover across context changes

`DatasetSession` now owns dataset lifecycle, but hover remains application/UI
state. Clear hovered-region state when changing datasets and whenever a
parcellation change can make the previous region identity invalid. Add a unit
or browser regression test demonstrating that stale hover cannot leak into the
new context.

### Required fix: hover styling after regional-tree rerender

`RegionalTreeView` replaces row DOM while retaining the cached hover ID. A
subsequent early return can leave the recreated row without its hover marker.
Reset/reapply the rendered hover presentation when rows are replaced and add a
focused regression test.

### Resolved prerequisite: deterministic regional-tree animation gate

While writing this runbook, the focused collapse-animation Playwright test
passed alone, but two consecutive `just check` runs failed the same assertion
under the parallel browser suite because the test acted before both asynchronous
initialization streams had settled. A focused test fix waits for the final Allen
metadata source and fixture distribution before triggering the collapse. It
passed 20 focused repetitions, three repetitions of the complete region-tree
spec, and the full browser suite. Preserve this readiness gate, row-reflow
behavior, and `prefers-reduced-motion` support during subsequent changes.

### Required fix or explicit simplification: active prefetch cancellation

`PrefetchQueue` creates an `AbortSignal`, but the dataset-session callback and
repository/source interfaces do not currently propagate it to an active
request. Prefer propagating the signal through the repository and HTTP resource
path, then test cancellation during an active prefetch. If the product only
intends to cancel queued work, simplify the API and documentation so it does
not claim active request cancellation.

Preserve the existing latest-wins scheduling and same-tick cancellation
behavior fixed by the PR's later commits.

### Review, test, and commit

Run focused unit tests while iterating, followed by:

```bash
just test-web
just test-browser
```

Manually smoke-test rapid dataset, release, feature, representation, and
parcellation switching; tree rerenders while hovering; and anatomy navigation.

Suggested commit:

```text
Fix dataset lifecycle interaction regressions
```

If active prefetch cancellation requires a broad transport change, make it a
separate coherent commit with its own tests.

## Phase 3 — readability and contract review

Retain the validation decomposition and shared contract corpus, but restore
normal readable formatting in files compressed into very long lines, notably
`web/src/data/contracts.ts` and `web/src/data/regional-data.ts`. Use an existing
authoritative formatter if the repository defines one; do not introduce a new
formatting stack for this task.

Expand contract fixtures only for concrete parity gaps found during review,
especially duplicate feature/parcellation identifiers, range/enum checks,
date-time behavior, representation cross-references, and catalog/release
identity consistency. Do not turn this into an unbounded schema redesign.

Run:

```bash
just test-builder
just test-web
git diff --check origin/main...HEAD
```

Suggested commit when changes are needed:

```text
Harden shared contract parity
```

Pure formatting may be a separate mechanical commit when that makes review
clearer.

## Phase 4 — reconcile durable documentation

Make documentation describe the integrated product rather than the temporary
refactor process.

Required changes:

1. Keep the PR's expanded `docs/ARCHITECTURE.md` dependency boundaries.
2. Use `main`'s detailed `docs/INTEGRATION_STATUS.md` as the base. Add the
   implemented PR facts—application sessions, renderer-independent spatial
   core, resource readers/shared materializers, validation split/parity corpus,
   anatomy and regional UI decomposition, shared regional serialization,
   publishing request/locking/maintenance changes, Vite plugin extraction, and
   architecture tests—without deleting scientific release status, benchmark
   evidence, blockers, or remaining launch work.
3. Add a decision to `docs/DECISIONS.md` accepting the layered browser
   dependency direction, runtime-extensible dataset IDs, and transport-neutral
   materialization boundary.
4. Remove `docs/CODEX_REFACTOR_HANDOFF.md`; do not land instructions to keep a
   parallel branch or prioritize app-shell work.
5. Update `docs/CODEX_HANDOFF.md` so task selection delegates directly to the
   earliest unblocked action in `docs/IMPLEMENTATION_PLAN.md` rather than
   maintaining another priority list.
6. Correct `README.md` where it still describes the obsolete 25 µm
   left-hemisphere anatomy default.
7. Correct the remaining-work summary so it no longer treats resolved Q10 as
   open or calls for relocation of the active anatomy assets.

Do not change `AGENTS.md`, `docs/LAUNCH_SPEC.md`, or
`docs/OPEN_QUESTIONS.md` merely because of this refactor.

Review all changed Markdown and run the relevant repository gates. Suggested
commit:

```text
Reconcile refactor integration documentation
```

Keep this runbook until the exact PR tip has passed final validation and is on
`main`; it is removed during final cleanup.

## Phase 5 — final validation on the exact PR tip

The worktree must be clean before the completion gate.

Run targeted gates first, then:

```bash
just check
git diff --check origin/main...HEAD
git status --short --branch
```

Push the coherent forward-fix commits to the existing PR branch. Do not
force-push or rewrite the reviewed stack. Require refreshed PR CI to pass on
the exact head SHA. Inspect the complete diff and confirm no unrelated files or
generated artifacts were committed.

Keep the PR draft until all required fixes, documentation reconciliation,
local gates, and remote CI are complete. A human review is strongly recommended
because this remains a large cross-cutting refactor.

## Phase 6 — integrate by fast-forward

Immediately before integration, verify:

```bash
git fetch origin
git rev-list --left-right --count origin/main...origin/work/refactor-architecture
git merge-base origin/main origin/work/refactor-architecture
git status --short --branch
```

If the left count is zero and the merge base is the current `origin/main`,
fast-forward the exact tested graph:

```bash
git switch main
git pull --ff-only origin main
git merge --ff-only origin/work/refactor-architecture
git push origin main
```

Do not squash, rebase, force-push, or recreate the implementation. The late PR
commits contain tests and behavior corrections for earlier refactor commits.

Record:

- rollback base: `d254c714d47b71f680734885e5205a68c4668cd0` unless recomputed because
  `main` advanced;
- final integrated tip SHA;
- successful PR CI run URL;
- successful `main` CI run URL.

Wait for GitHub Actions on `main`. Do not start new product work before that
run is green.

## Phase 7 — remove temporary integration state

After `main` CI is green:

1. remove this file, `docs/PR4_INTEGRATION_RUNBOOK.md`, on `main`;
2. verify `docs/CODEX_REFACTOR_HANDOFF.md` is already absent;
3. commit the removal as `Remove completed PR4 integration runbook`;
4. run `just check` and require the resulting `main` CI to pass;
5. verify PR #4 is closed as merged, closing it manually only if GitHub did not
   recognize the fast-forward;
6. delete the remote `work/refactor-architecture` branch;
7. prune local remote-tracking references;
8. verify the remote has only `main`:

```bash
git push origin --delete work/refactor-architecture
git remote prune origin
git ls-remote --heads origin
git status --short --branch
```

Do not delete the branch before the integrated `main` CI succeeds. The branch
is a temporary operational reference until then.

## Rollback

Never reset or force-push shared `main`. If integration fails before subsequent
product work begins, revert the exact integrated range in a new commit:

```bash
git switch main
git pull --ff-only origin main
git revert --no-commit <rollback-base>..<integration-tip>
git commit -m "Revert PR #4 architecture integration"
git push origin main
```

Inspect the revert, run targeted gates and `just check`, and wait for `main` CI.
If later work exists on top, reassess the revert range rather than applying
these commands mechanically.

## Completion checklist

Integration is complete only when all of the following are true:

- concrete publishing, CI, hover, tree-rerender, and prefetch findings are
  fixed or explicitly resolved with tests and durable rationale;
- the regional-tree animation test passes reliably both alone and in the full
  parallel browser suite;
- normal source readability is restored where needed;
- durable architecture and integration-status documents agree with the actual
  product;
- `just check` and GitHub Actions are green on final `main`;
- PR #4 is closed;
- this temporary runbook and the old refactor handoff are absent from `main`;
- `git ls-remote --heads origin` lists only `refs/heads/main`;
- the worktree is clean and `main` tracks `origin/main`;
- rollback SHAs and CI evidence are recorded in the final handoff/status update.

After completion, select the next task from `docs/IMPLEMENTATION_PLAN.md`:
M1 non-production-origin acceptance for the validated `2026_W32` channel
release, or M2 representative volume transport benchmarking if the required
origin or credentials are unavailable.
