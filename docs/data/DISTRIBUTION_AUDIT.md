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

The downloaded `ibl-scalar-distribution-human-review-v1` record is deliberately
non-authoritative: it states `production_effect: "none"` and omits
`scientific_owner_confirmation`. Returning that record constitutes review
input, not an approved selection or permission to publish. After explicit
owner approval, translate the reviewed choices into all four complete
selection artifacts and follow the immutable rebuild sequence below.

## Future-agent handoff: complete Q14 audit and reviewed rollout

Status: **NEXT DISTRIBUTION TASK; read-only audit first; no remote publication
authorized**.

The D050 contract and D053 compact-range interaction are complete. D052 is the
only new feature-specific Q14 decision: regional channel `peak_val.raw` offers
Linear and Signed log (`c = 1.23`) plus Full and Focused
(`[-9.467077467918395, 2.5583932574651715]`) and defaults to
Linear/Focused. Do not generalize that choice automatically. Every other new
Signed-log/Focused selection remains open under Q14.

The next agent should execute this sequence:

1. Inventory the current immutable local releases for all four representations:
   channels `2026_W32-d050-peak-val-raw-v7`, clusters
   `sha256-9b5e55215b306f26-d050-d048-v6`, Brain-Wide Map
   `legacy-v1-1d908bea-d050-linear-full-v2`, and volume
   `2026_W26-candidate-depth4-d050-linear-full-v3`.
2. Audit the complete pinned source populations, not stored 50-bin release
   histograms: all finite channel, cluster, and Brain-Wide Map source rows, and
   valid finite voxels only for each volume feature. Follow the exact source,
   population, and validity provenance in `docs/DATA_SOURCES.md` and the
   dataset-specific selection/source documents. SSH Fractal may be used to
   locate already-pinned source bytes, but the local audit must verify their
   recorded identities before consuming them.
3. Write deterministic per-dataset JSON evidence under the ignored
   `artifacts/distribution-audit/` workspace. Produce a concise review table
   covering every feature and including finite/missing/sign counts, extrema and
   robust quantiles, largest-bin fraction or equivalent Full-view collapse
   evidence, candidate Focused bounds and exact tails, Log eligibility, and
   candidate raw-unit Signed-log thresholds. Candidate values are evidence,
   never selections.
4. Rank features for human review. Recommend Focused as the default only when
   Full materially collapses the scientifically useful body of the
   distribution; offer Focused without making it default for borderline cases;
   retain Full for already readable, bounded, discrete, or sparse
   distributions. Review scale independently: Log requires a completely
   positive finite population, while Signed log is a candidate for mixed-sign
   heavy tails. Do not infer a palette, meaningful center, threshold, bounds,
   or default.
5. Present the channel, cluster, Brain-Wide Map, and volume proposal in the
   local interactive lab. Stop before editing a selection unless the owner
   explicitly approves exact feature/representation choices. Regional and
   volume choices for the same feature remain independent.
6. After approval, update the four machine-readable selection files in this
   directory, preserving an explicit entry for the complete feature catalog.
   Add/update deterministic selection tests and record the decisions in
   `docs/DECISIONS.md` and Q14.
7. Commit the reviewed selections before building so builder provenance records
   a clean source commit. Build new immutable local release IDs; never overwrite
   the four candidates listed above. Validate the complete release graphs,
   exact scale/domain cross-products and tail identities, then run each
   dataset-specific real-browser suite, `just validate-local-full`, and
   `just check`.
8. Update the local launcher defaults and durable handoff/status documentation
   only after all new candidates are green. Keep the previous immutable local
   releases available. Do not publish, push, create a PR, or modify remote
   aliases/origins without separate authorization.

Acceptance evidence for this future task consists of the four source-array
audit reports plus their review table, explicit owner approvals, committed
selection bytes, new immutable local release IDs, schema/integrity validation,
dataset-specific browser results, integrated Summary/Top/Swanson/3-D local
validation, a green `just check`, and a clean `main` worktree.
