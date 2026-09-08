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

D074 selects the reviewed `2026_W32` source for the initial website deployment.
This question remains only for a separately promoted final paper freeze.

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

The initial staging preparation identified an operational gap, now resolved
by the explicit staging-only benchmark publisher. For direct first deployment,
non-catalogued benchmark delivery at the existing origin still needs a tested
implementation. Ordinary dataset publication still rejects candidate IDs.
Do not remove that production guard or rename the candidate to bypass it.

## Q8 — Production public origin and storage

Status: **DECISION; partially resolved by D040, D059, D060, and D072**.

Resolved direction: use IBL-owned S3 for immutable objects with CloudFront as
the preferred HTTPS/browser origin. Do not use or modify `iblviz` without
explicit repository-owner permission.

D059 selects `ibl-brain-wide-map-private` in `us-east-1` for both environments,
with exact roots
`aggregates/atlas/ephys-atlas-web-v2/staging/` and
`aggregates/atlas/ephys-atlas-web-v2/production/`. D072 selects
`ephys-atlas.iblcore.org` as the production viewer domain. D059
requires immutable release/pack keys to be protected against overwrite while
catalogs and aliases remain separately mutable.

D060 selects a lean, AWS-only runtime topology for initial deployment:
CloudFront serves both the compiled Vite viewer and public data from the
private S3 namespace at `ephys-atlas.iblcore.org`; Cloudflare Pages and an
always-on publishing server are not used. Publication is an operator-invoked
local repository command using temporary least-privilege AWS credentials and
the existing validation/immutability semantics. The HTTP capability-token
service remains an optional future path rather than a launch dependency.

D062 separately fixes the execution host: canonical release builds,
production preflight, and publication run on Linux. macOS is development and
preview only. This is no longer part of Q8.

Current operational evidence: authenticated terminal listing, object metadata
reads, and a non-mutating conditional `PutObject` authorization probe succeeded
on 2026-09-02 for the private `us-east-1` bucket
`ibl-brain-wide-map-private` below `aggregates/atlas/`. Anonymous listing is
denied. No remote object was mutated. The 2026-09-02 DNS check concerned the
iblcore.org hostname. D072 records the current Cloudflare zone/DNS-read evidence.
After reauthentication, the 2026-09-08 read-only audit confirmed production
distribution `ET6VJW8JWAGVR` (`d2is8oq6heobqy.cloudfront.net`) with the exact
production origin path, active DNS/TLS and HTTP-to-HTTPS redirection. The bucket
blocks public access; OAI `E359S50BKNNGWZ` may read only production `site/*`,
`atlas/*`, `datasets/*`, `catalog.json` and an extra root `index.html`.
Both environment prefixes were empty. Read access is verified; publisher write
access and isolated staging delivery remain unverified. Observed OAI differs
from the OAC setup in the runbook and is not an approved migration decision.
See
[`docs/publishing/S3_DEPLOYMENT.md`](publishing/S3_DEPLOYMENT.md).

D074's direct first-deployment amendment removes isolated staging as a
prerequisite. Use the existing production OAI/distribution and preserve shared
bucket settings. The approved artifact set and initial defaults are fixed;
remaining work is scoped routing/cache setup, actual publisher authorization,
remote delivery validation and Q5 benchmarking.

The administrator subsequently enabled router creation/read/test/publication
and distribution/function updates (conditional probes reach ETag validation).
Invalidation creation/read and S3 private write/readback/update passed. The
router is LIVE but unattached. GetFunction and GetDistribution supply the
needed code/configuration and ETags; the remaining DescribeFunction and
GetDistributionConfig denials are not operational blockers. No additional
administrator request is currently needed for the direct deployment path.

Remaining: canonical publication, actual distribution update, production-origin
QA and Q5 confirmation. Owner authorization is already recorded.

## Q9 — Paper-facing release aliases and defaults

Status: **DECISION**.

The architecture supports mutable aliases outside immutable release
directories. D061 fixes immutable `(project_id, edition_id)` mappings, explicit
scoped edition membership, curator-owned catalog promotion, catalog-owned
defaults, exact URL canonicalization, and custom-edition baselines. The
paper-facing viewer default must resolve to a frozen release set.

Resolution needed: the exact public project-edition ID and label, its explicit
approved dataset scope and dataset-to-immutable-release mapping, the real
`default_project`, per-project `default_dataset`, and `default_edition` values,
any mutable alias names, and the freeze date/process. D056/D061 fix the
Project/Dataset/Release/Feature/View hierarchy and require individual release
overrides to remain explicitly custom, optionally retaining their originating
edition baseline; they do not choose the real values.

Blocks: final production catalog/defaults and the publication reproducibility
statement.

D074 approves initial website defaults: Ephys Atlas channels, denoised AP RMS,
Allen parcellation and linked 2-D slices. The implementation may assign initial
edition/release IDs and build the tracked catalog. The final paper freeze stays
separate from this first deployment.

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


## Q19 — AGEA processing, validity and registration

Status: **DECISION** for a real AGEA release; not a launch blocker. D067
authorizes the full catalog and one selected expression volume at a time.
D069 additionally authorizes a main-website local preview: original values,
all measured nonnegative voxels valid, `-1` missing, no coarse-label outside
mask, and unchanged source affine with explicitly provisional registration.
This resolves the local-preview recipe only, not public release acceptance.

D074 subsequently authorizes this exact recipe for the initial website
deployment, with provisional processing/registration notes only in Data details.
Neutral main-viewer labels do not imply completed scientific validation. The
remaining review below concerns final scientific acceptance, not whether this
provisional dataset may be deployed.

The [source audit](data/AGEA.md) pins the original 4,345-experiment IBL
collection, confirms one Allen energy-volume conversion exactly, and derives
the loader's 200 µm coordinate mapping. Original and processed source variants
are distinct scientific inputs. The raw audit finds both missing measurements
inside labelled anatomy and nonnegative measurements outside it.

Resolution needed:

- choose original or processed input and pin the selected exact bytes;
- decide whether valid observations include every measured source voxel or
  only nonzero labelled anatomy; specify outside/missing precedence and preserve
  measured zero values;
- accept the source-derived affine/reference-space evidence against the native
  anatomy, including the expected coarse-grid boundary behavior;
- approve expression semantics, display distributions and source release label.

The benchmark's finite/nonnegative statistics are explicitly a sizing
assumption, not a release selection. Do not reuse W26's zero-as-outside rule.
Duplicate gene symbols remain distinct experiments under D067. This question
blocks real scientific release construction, not synthetic bundle/picker/cache
machinery or transport-only source measurements.

## Resolution procedure

When authoritative evidence arrives:

1. record the answer in a decision or machine-readable selection as applicable;
2. move the closed question to [`RESOLVED_QUESTIONS.md`](RESOLVED_QUESTIONS.md)
   while preserving its stable Q identifier;
3. update the implementation plan and affected source/recipe authority;
4. implement and test the production behavior;
5. record the choice in immutable release provenance when scientifically
   relevant.
