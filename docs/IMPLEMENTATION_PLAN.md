# Implementation plan

Status: active execution registry.

This file contains only incomplete work and the shortest path to launch.
Completed behavior belongs in code, decisions, evidence, and
[`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md). Work top-to-bottom when a lane
is unblocked; never invent an answer from [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

## Current state

Schema v1, all four scientific builders, the retained five-view 2-D viewer,
optional 3-D context, local ZIP authoring/import, downloads, project-edition
navigation, distributions, comparison foundations, and the reviewed local data
bundle are implemented. Linux is now the canonical production environment;
macOS is a preview host. `just data-refresh-local` verifies whether upstream
channel/cluster `latest` aliases still match the reviewed releases and stops if
new scientific review is needed.

The launch path is constrained by Q8, then Q5, Q2, and Q9.

## M6 — Finish staging and publication machinery

Status: active; locally testable release preflight is complete, remote
infrastructure and the local S3 publisher are not.

Blocker: Q8 for exact CloudFront/OAC/DNS/TLS/header policy, publisher IAM, and
authorization of the first staging artifact set. Remote mutation requires
explicit authorization and credentials.

Next actions:

1. Implement the D060 operator-invoked S3 publisher by reusing schema/integrity
   validation and immutable create-only semantics. It must invoke the same
   checks as `just production-release-preflight <release...>`.
2. Provision the isolated staging distribution and origin path selected by Q8.
3. Publish one authorized Linux-built immutable artifact set, promote mutable
   indexes last, and record served-byte SHA-256, MIME, CORS, Range, and cache
   evidence.
4. Create a new development-bundle descriptor with exact immutable HTTPS
   sources and prove `just data` from a clean checkout.
5. Only after staging evidence is accepted, provision the equivalent
   production boundary and deploy the Vite site under `site/`.

Runbook: [S3 deployment](publishing/S3_DEPLOYMENT.md). Acceptance:
[`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 10, 11, and 13.

## M2 — Confirm and build the production volume release

Status: blocked by Q5, which depends on the Q8 staging origin. D043 already
fixes W26 geometry and validity; local evidence favors depth-four orthogonal
slice packs.

After staging exists:

1. Repeat depth-four measurements at the real origin, recording requests,
   bytes, decode/interaction latency, and memory.
2. Resolve Q5 from that evidence.
3. Build a new immutable W26 release on clean Linux `main`, run production
   preflight, stage it, and repeat linked-slice acceptance.

Never generalize D043 beyond the pinned W26 source. Evidence and procedure:
[`data/VOLUME_2026_W26_EVIDENCE.md`](data/VOLUME_2026_W26_EVIDENCE.md).

## M1/M3/M4 — Freeze the paper dataset set

Status: reviewed local channel, cluster, and Brain-Wide Map releases are green;
paper identity and publication remain incomplete.

Blockers: Q2 selects the channel vintage. Q9 selects the public project edition,
dataset-to-release mapping, defaults, aliases, and freeze process.

After those decisions:

1. Pull and pin the selected channel source; apply only approved recipe and
   selection artifacts.
2. Build every production scientific release on clean Linux `main` and run
   `just production-release-preflight <release...>`.
3. Stage and verify the complete set without altering immutable bytes.
4. Compile and promote the curator-owned catalog/edition mapping last.

Dataset authority: [`data/README.md`](data/README.md). Acceptance:
[`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 2–7.

## M7 — Final release QA

Status: blocked until the production origin, releases, and defaults exist.

Run from the release commit on Linux:

1. Run `just check` and every release preflight.
2. Record production-origin performance and failure behavior.
3. Exercise desktop/tablet/phone, deep links, downloads, and local import.
4. Run Chromium automation plus the D040 Firefox and native Safari matrix.
5. Resolve or explicitly waive every launch blocker, then update
   [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md) to shipped reality.

## Independent non-launch work

These remain useful but must not displace the launch path:

- capture representative native-Safari quota/RSS evidence before advertising
  broad local-import capacity; publish `ibl-ephys-atlas` only with authorization;
- run scientist review of the implemented multi-feature Focus/Gallery/Profile
  UX; Q17 retains real normalization populations;
- select real-feature palette/center metadata under Q16;
- pursue D055 unlisted sharing only after Q15;
- keep richer 3-D, AGEA, MERFISH, point clouds, inferential statistics, and
  broad legacy compatibility deferred.

## Agent completion rule

Inspect current code/tests, implement one coherent vertical slice, run targeted
tests and `just check`, update durable authority when reality changes, commit
only intended files, and leave the next action explicit. A blocker permits work
on an independent lane; it never permits guessing the blocked choice.
