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

Status: **DECISION; partially resolved by D040 and D059**.

Resolved direction: use IBL-owned S3 for immutable objects with CloudFront as
the preferred HTTPS/browser origin. Do not use or modify `iblviz` without
explicit repository-owner permission.

D059 selects `ibl-brain-wide-map-private` in `us-east-1` for both environments,
with exact roots
`aggregates/atlas/ephys-atlas-web-v2/staging/` and
`aggregates/atlas/ephys-atlas-web-v2/production/`. It also selects
`ephys-atlas.iblcore.org` as the planned initial public viewer domain and
requires immutable release/pack keys to be protected against overwrite while
catalogs and aliases remain separately mutable.

Current operational evidence: authenticated terminal listing, object metadata
reads, and a non-mutating conditional `PutObject` authorization probe succeeded
on 2026-09-02 for the private `us-east-1` bucket
`ibl-brain-wide-map-private` below `aggregates/atlas/`. Anonymous listing is
denied. No remote object was mutated. DNS for the planned viewer domain did not
yet resolve from the repository host when checked on 2026-09-02.
See
[`docs/publishing/S3_DEPLOYMENT.md`](publishing/S3_DEPLOYMENT.md).

Resolution still needed: how the public viewer reaches private S3 data, whether
CloudFront is used or D040 is explicitly revised with another HTTPS delivery
boundary, the data hostname/path and DNS/TLS/hosting arrangement, exact
cache/CORS/MIME/Range policy, and whether publication uses direct validated AWS
CLI operations or a publishing-service/object-storage adapter.

Blocks: production-origin QA, immutable asset/release deployment, Q5
confirmation, and final deployment documentation.

## Q9 — Paper-facing release aliases and defaults

Status: **DECISION**.

The architecture supports mutable aliases outside immutable release
directories. The paper-facing viewer default must resolve to a frozen release
set.

Resolution needed: the exact public project-edition ID and label, its complete
dataset-to-immutable-release mapping, the default edition, any mutable alias
names, and the freeze date/process. D056 fixes the Project/Dataset/Release/
Feature/View hierarchy and requires individual release overrides to leave or
be disclosed outside the coordinated edition; it does not choose these values.

Blocks: final production catalog/defaults and the publication reproducibility
statement.

## Q15 — Unlisted-sharing deployment policy

Status: **DECISION** for deploying the optional D055 sharing path; not a launch
blocker.

D055 fixes the product and security boundary: unlisted expiring shares use
anonymous browser uploads through a separate CloudFront OAC boundary into
private S3, remain outside the public catalog, and are validated again by the
recipient. The design intentionally has no Lambda, EC2, Cognito, user account,
or publishing-service dependency in its first version.

Resolution needed: exact share bucket/prefix, CloudFront distribution and data
domain; retention duration; per-resource and honest-client aggregate ceilings;
allowed CORS origin and response-header policy; WAF method and rate rules;
storage/request alarm thresholds and owners; the emergency upload-disable
procedure; and whether the residual anonymous-storage cost exposure is accepted
for the initial deployment. Do not reuse the official publication namespace or
invent any of these production values during implementation.

Blocks: deployment or user-visible enablement of unlisted sharing only.

## Q16 — Real-feature palette and diverging-center selections

Status: **DECISION** for a future immutable presentation release; not a launch
blocker.

D057 fixes the infrastructure policy: feature representations may own a
preferred palette, Auto resolves that preference, and diverging palettes
require an explicit release-owned center. Synthetic fixtures may implement and
exercise this machinery.

Resolution needed: audit and owner-review the exact preferred palette and,
where diverging presentation is scientifically meaningful, the exact center
for every affected channel, cluster, Brain-Wide Map, and volume feature
representation. Record the complete hash-bound choices in versioned selection
artifacts and build new immutable releases. Do not infer choices from feature
names, sign distributions, v1 defaults, or an arithmetic range midpoint, and
do not edit the D054 selection artifacts in place.

Blocks: real release-owned palette defaults and diverging-center metadata only.
It does not block the neutral Auto/fallback machinery, the expanded palette
registry, or launch with existing Viridis behavior.

## Q17 — Multi-feature z-score normalization populations

Status: **DECISION** for real-data multi-feature comparison; not a launch
blocker.

D058 fixes z-score as the shared comparison encoding, canonical release-owned
feature ordering, and the separation between comparable regional and volume
sampling. It does not define which real scientific population owns each mean
and standard deviation.

Resolution needed: for every dataset and supported comparison representation,
select the population, validity/QC inclusion, any transform applied before
standardization, parcellation dependence, weighting, zero-variance behavior,
and immutable source of the normalization parameters. In particular, decide
whether regional feature z-scores use source observations or the regional
summary population. Record reviewed parameters in versioned selection
artifacts and immutable release provenance. Do not calculate an undocumented
baseline from whatever values the browser happens to have loaded.

Blocks: real-data z-score comparison defaults and releases only. It does not
block pure domain/application machinery, synthetic fixtures, the UX lab, or
scientist testing with clearly labelled synthetic normalization.

## Resolution procedure

When authoritative evidence arrives:

1. record the answer in a decision or machine-readable selection as applicable;
2. move the closed question to [`RESOLVED_QUESTIONS.md`](RESOLVED_QUESTIONS.md)
   while preserving its stable Q identifier;
3. update the implementation plan and affected source/recipe authority;
4. implement and test the production behavior;
5. record the choice in immutable release provenance when scientifically
   relevant.
