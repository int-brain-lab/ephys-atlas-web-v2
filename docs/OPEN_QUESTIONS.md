# Open questions

Status: active blocker and decision registry.

This file contains only choices that remain open and that an implementation
agent must not guess. Closed identifiers are indexed in
[`RESOLVED_QUESTIONS.md`](RESOLVED_QUESTIONS.md).

Status labels:

- **BLOCKER** — required before the affected production release or launch gate;
- **DECISION** — coding may continue, but production configuration needs an
  explicit answer.

## Q2 — Channel source vintage

Status: **BLOCKER** for the paper-facing production release.

Current evidence: the private example uses `ea_active/2025_W28`; development
guidance permits following the latest available encoding/channel products. A
newer immutable `2026_W32` snapshot is built and validated for development, but
it has not been selected as the paper snapshot.

Resolution needed: the exact immutable `ea_active` vintage for the paper-facing
release. Development may follow `latest` only when it resolves and records the
immutable vintage used for each release.

Blocks: paper-facing channel release and final catalog defaults.

## Q5 — Production volume transport

Status: **BLOCKER** for production volume packaging.

Schema v1 permits `chunks3d` and `orthogonal_slice_packs`. The checksummed W26
source has complete depth-4/depth-8 candidates and local/simulated browser
evidence. Depth-four orthogonal packs remain the recommendation: they require
fewer bytes, lower cold latency, and roughly half the decoded center-pack memory
of depth eight in the constrained profile.

Resolution needed: repeat the depth-four measurements at the selected
CloudFront origin and choose the production layout from recorded request count,
transferred bytes, decode latency, interaction latency, and memory.

Do not reopen D043 geometry while selecting transport. Exact current evidence
and limitations are in
[`data/VOLUME_2026_W26_EVIDENCE.md`](data/VOLUME_2026_W26_EVIDENCE.md).

Blocks: final browser transport and the immutable production volume release.

## Q8 — Production public origin and storage

Status: **DECISION; partially resolved by D040**.

Resolved direction: use IBL-owned S3 for immutable objects with CloudFront as
the preferred HTTPS/browser origin. Do not use or modify `iblviz` without
explicit repository-owner permission.

Resolution still needed: final bucket, distribution, and domain names; exact
cache/CORS policy; and whether publishing writes directly to S3 or through an
intermediate filesystem/object-sync layer.

Blocks: production-origin QA, immutable asset/release deployment, Q5
confirmation, and final deployment documentation.

## Q9 — Paper-facing release aliases and defaults

Status: **DECISION**.

The architecture supports mutable aliases outside immutable release
directories. The paper-facing viewer default must resolve to a frozen release
set.

Resolution needed: alias naming (`paper`, publication label, or another stable
name), exact dataset release IDs, and the freeze date/process.

Blocks: final production catalog/defaults and the publication reproducibility
statement.

## Q14 — Remaining audited scale and focused-domain selections

Status: **DECISION; partially resolved by D052**.

D050 implements Linear/Log/Signed-log scales and independent Full/Focused
domains. D052 approves only regional channel `peak_val.raw`: Linear and Signed
log with raw-unit threshold `1.23`, Full and Focused with exact bounds
`[-9.467077467918395, 2.5583932574651715]`, defaulting to Linear/Focused.
Existing baseline migrations retain Linear/Full plus D048's reviewed cluster
Log choices.

Resolution still needed: owner-reviewed complete selections for every channel,
cluster, Brain-Wide Map, and volume feature/representation. Each selection must
state available scales, any finite positive Signed-log threshold, Focused
availability and exact raw bounds, and preferred scale/domain. Log requires a
strictly positive complete finite population; regional and volume selections
remain independent.

Until reviewed, do not infer thresholds/bounds in the browser or builder, copy
audit quantiles automatically, mutate immutable releases, or generalize D052.
Read-only audits and review tables are unblocked; follow
[`data/DISTRIBUTION_AUDIT.md`](data/DISTRIBUTION_AUDIT.md). The four source
audits are complete and recorded in
[`data/DISTRIBUTION_AUDIT_EVIDENCE.md`](data/DISTRIBUTION_AUDIT_EVIDENCE.md);
selection remains blocked on owner review.

Blocks: only additional per-feature Signed-log/Focused availability or defaults.

## Resolution procedure

When authoritative evidence arrives:

1. record the answer in a decision or machine-readable selection as applicable;
2. move the closed question to [`RESOLVED_QUESTIONS.md`](RESOLVED_QUESTIONS.md)
   while preserving its stable Q identifier;
3. update the implementation plan and affected source/recipe authority;
4. implement and test the production behavior;
5. record the choice in immutable release provenance when scientifically
   relevant.
