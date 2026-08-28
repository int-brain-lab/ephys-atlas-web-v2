# Distribution-presentation audit

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
