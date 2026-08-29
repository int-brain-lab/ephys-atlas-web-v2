# Distribution-presentation audit

Status: runbook for Q14 evidence and reviewed rollout.

`builder/ephys_atlas_builder/distribution_audit.py` is the read-only evidence
kernel for the planned Linear, Log, Signed log, Focused and Full distribution
contract. It consumes the actual scalar observation population and writes a
deterministic JSON report through `audit_feature_arrays()`.

It records finite/non-finite and sign counts, robust quantiles, full-range
exact linear/log/signed-log candidate histograms, focused-domain tail counts,
bin occupancy, and uncompressed artifact-size estimates. Signed-log thresholds
and focused bounds are intentionally **candidate-only**. The report never
chooses a display scale, transform, focus domain, palette, or default.

Focused candidates preserve one raw-value lower/upper bound (used as the exact
first/last edge, never snapped to observations) and whole-population
underflow/overflow counts across their exact Linear, eligible Log, and each
candidate Signed-log binning. Log remains eligible only when the complete
finite source population is strictly positive; Focused must not hide a
zero/negative tail to manufacture that capability. They never renormalize a
hidden tail away.

An existing schema-v1 release is insufficient to create new exact signed-log
or focused bins: its stored linear histogram has already lost within-bin source
positions. Audits must therefore read the pinned source observations (channels,
clusters and Brain-Wide Map table rows) or valid scalar voxels (volumes). It is
scientifically invalid to stretch or re-bin an existing histogram in the
browser or audit tool.

For volumes, first classify each voxel using the release-owned validity policy;
only valid finite voxels enter the scalar distribution. The report describes
them as valid voxels, not independent scientific samples. Outside and missing
voxels are reported separately by the caller/release validity evidence.

This is evidence machinery only. A later reviewed selection document must bind
any scale availability, signed-log threshold, focused bounds and defaults to a
new immutable release.

## Reviewed selection input

D050 real-source builders require a separate owner-reviewed selection after the
audit. The reviewed migration selections are
`CHANNELS_DISTRIBUTION_SELECTION.json`,
`CLUSTERS_DISTRIBUTION_SELECTION.json`,
`BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json`, and
`VOLUME_2026_W26_DISTRIBUTION_SELECTION.json` in this directory. The versioned
machine input has this shape (the values below illustrate the contract only and
are not another scientific selection):

```json
{
  "schema": "ibl-scalar-distribution-selection-v1",
  "selection_id": "owner-assigned-versioned-id",
  "scientific_owner_confirmation": true,
  "dataset_id": "ephys_atlas_channels",
  "representation": "regional",
  "source_release_id": "exact-source-release-id",
  "features": [
    {
      "id": "exact.output.feature.id",
      "display": {
        "scales": [{"kind": "linear"}],
        "preferred_scale": "linear",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full"
      }
    }
  ]
}
```

`representation` is `regional` for channels, clusters, and Brain-Wide Map and
`volume` for encoding volumes. The selection must enumerate the exact complete
output feature catalog. The builder rejects a dataset, representation, source
release, feature, Log eligibility, Signed-log threshold, Focused interval, or
display-range mismatch. It copies the exact reviewed bytes into the immutable
release as `distribution-selection.json` and records their SHA-256 in provenance;
it never derives a choice from the audit report or from a previous histogram.

## Release inventory and commands

Use the inventory before mounting a source snapshot. It reports what exact
linear/log bins already exist, but deliberately marks new Signed-log and
Focused candidates unavailable when only accumulated release histograms are
present:

```bash
uv run --project builder --extra test --locked ephys-atlas-data \
  inventory-distributions data/releases/ephys_atlas_channels/2026_W32 \
  --output artifacts/distribution-audit/channels-release-inventory.json
```

Run the same command for the cluster, Brain-Wide Map and volume release roots.
The `audit_feature_arrays()` and `audit_volume_feature_arrays()` entry points
are the explicit source-array adapters for the next step. Feed them pinned
channel/cluster/BWM source rows; for volumes feed the decoded source values and
the release-owned `outside_value`. This distinction is intentional: it prevents
new exact candidates from being fabricated from a 50-bin release summary.

For a reproducible command-line handoff, create a small *pinned* NPZ with one
named numeric source array per feature (not histogram edges or counts), then:

```bash
uv run --project builder --extra test --locked ephys-atlas-data \
  audit-source-arrays /absolute/path/pinned-channel-arrays.npz \
  --dataset-id ephys_atlas_channels --release-id 2026_W32 \
  --representation regional --population 'inside channels from pinned W32 source' \
  --observation-unit channels \
  --output artifacts/distribution-audit/channels-source.json
```

For volumes use `--representation volume --outside-value <release-owned-sentinel>`;
the command rejects an implicit sentinel. The NPZ preparation itself is a
source adapter and must preserve its source hash/provenance beside the report.
`audit-source-arrays` records the input NPZ's exact byte size and SHA-256 in
`source_array_evidence`; its path is evidence for local review only.

The canonical W26 encoding-volume NPZ already stores all features on one last
axis. Audit it directly, without creating a second 790 MB intermediate archive,
only after supplying its recorded identity and release-owned outside sentinel:

```bash
uv run --project builder --extra test --locked ephys-atlas-data \
  audit-volume-source data/source/ephys_atlas_volumes/2026_W26/brainwide_ephys_atlas_50um.npz \
  --dataset-id ephys_atlas_volumes --release-id 2026_W26 \
  --outside-value 0 --expected-bytes 238954924 \
  --expected-sha256 1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253 \
  --output artifacts/distribution-audit/volumes-source.json
```

The adapter verifies the full NPZ before loading its feature-name metadata,
streams each last-axis feature into bounded temporary storage, audits valid
finite voxels, records the original NPZ/member identity, and deletes the
temporary extraction after the report is written.

Turn any audit report into the concise owner-review table required below with:

```bash
uv run --project builder --extra test --locked ephys-atlas-data \
  summarize-distribution-audit artifacts/distribution-audit/volumes-source.json \
  --output artifacts/distribution-audit/volumes-review.md
```

The table ranks only the measured Full linear largest-bin fraction and exposes
the exact population/sign counts, range/quantiles, Focused tails, Log
eligibility, and candidate Signed-log thresholds. It remains explicitly
non-authoritative and makes no presentation selection.

## Local interactive owner review

Build and serve the self-contained review lab from the four exact audit reports
and accepted baseline selections:

```bash
just distribution-review-lab
just distribution-review-lab-serve
```

Open `http://127.0.0.1:8765/`. The builder fails closed if a frozen report hash,
dataset/release identity, or complete feature catalog differs from the accepted
selection. The page embeds the exact audited histograms and tails, compares the
accepted baseline with `q14-agent-candidate-policy-v1`, and permits accepting
the proposal, retaining the baseline, or editing each feature with notes.
The guided default queue contains only the 34 features whose proposal differs
from the baseline; the other 121 are exported explicitly as unchanged. Each
step has two primary choices and advances automatically. The always-visible
keyboard controls are `R` for the recommendation, `C` for the current setting,
`E` to edit, `W` for evidence, and the arrow keys for navigation.
Every decision is saved immediately in browser-local storage under an identity
derived from the policy version and all four audit hashes, and a reload resumes
at the next undecided feature. The evidence view compares the current default
histogram with a newly offered scale/domain combination; it stays open across
navigation until `W` is pressed again.

The downloaded `ibl-scalar-distribution-human-review-v1` record is deliberately
non-authoritative: it states `production_effect: "none"` and omits
`scientific_owner_confirmation`. Returning that record constitutes review
input, not an approved selection or permission to publish. After explicit
owner approval, translate the reviewed choices into all four complete
selection artifacts and follow the immutable rebuild sequence below.

## Completed implementation: immutable D054-bound rebuilds

Status: **COMPLETE LOCALLY; no remote publication authorized**.

The exact 155-feature review is committed as
[`Q14_DISTRIBUTION_REVIEW_2026-08-29.json`](Q14_DISTRIBUTION_REVIEW_2026-08-29.json).
All 34 proposals were accepted and all 121 other choices were retained. D052
and D048 survive exactly within D054; regional and volume choices remain
independent.

The completed sequence was:

1. Commit the four complete reviewed selection files while the worktree is
   clean so builder provenance records their exact source commit.
2. Build new immutable local channel, cluster, Brain-Wide Map, and depth-four
   candidate volume release IDs. Never overwrite the prior D050 releases.
3. Validate complete graphs, scale/domain cross-products, exact Focused tails,
   and real-browser behavior for every dataset. Prove deterministic rebuilds
   byte-for-byte.
4. Create a new immutable development-bundle descriptor only after all four
   releases are green; update local launcher defaults and durable status docs,
   then run `just validate-local-full` and `just check`.

Keep every prior immutable release available. Do not publish, push, create a
PR, or modify remote aliases/origins without separate authorization.

The exact release identities, manifest hashes, deterministic rebuild counts,
dataset-specific browser results, and integrated Summary/Top/Swanson/3-D local
validation are recorded in
[`DISTRIBUTION_AUDIT_EVIDENCE.md`](DISTRIBUTION_AUDIT_EVIDENCE.md). Remote
publication and alias changes remain outside this authorization.
