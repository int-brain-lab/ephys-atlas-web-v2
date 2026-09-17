# Regional-distribution deployment

Status: complete on 2026-09-17.

The D079 deployment is live at <https://ephys-atlas.iblcore.org>. It preserves
all previously published releases and editions, retains Brain-Wide Map, keeps
Ephys Atlas channels as the overall default, and adds the processed AGEA and
regional W26 successors as new project-default editions.

## Published identities

| Artifact | Identity | Manifest SHA-256 / transaction |
| --- | --- | --- |
| Site | `f08a249fa97ea7dcd21110cd9a07e1b0` | `2a3ca5244e47f4da894eafc56460cbdd72c1fff90aded9abc9cd089d19164e99` |
| W26 volumes | `2026_W26-ibl-review-20260917-v2` | `ff982c8746edb6028f147233a2fbf65db7c25a91d2c2f7331c9f0118ea99e0dc`; transaction `d4c72e7f88b0fb3227d22bcf49df9e8173bd721698ead85f4cb9cbfb44f2cfd1` |
| Processed AGEA | `agea-processed-20260917-v3` | `36c7758d44531c0c3932262f9e275393b310a5b1e87e0e2011980be6f7e5c2da`; transaction `cecc61326a970c1b895007a9cc39a67016156bd8dca20756f9f649eb5310467b` |
| Catalog | `2a152441f24c4c0a81bdad190e3e507c` | `817c3854b9be9989ba763756a554260611443823a0fe37a394f47ce113e77843` |

Both releases were built on clean Linux `main` at
`c3991d64ce49718a3e5a971099d83f02263049a4`, passed production preflight and
their real-release browser suites, and were published only after the compatible
site. The complete seven-release catalog was promoted last after remote
completion-record, inventory, checksum, size and serving-metadata verification.
The 5,318-byte live catalog selects Ephys Atlas edition
`ibl-review-20260917-v3` and Anatomy edition `ibl-review-20260917-v2` while
retaining every earlier mapping.

## Production checks

Direct HTTPS reads returned site build
`f08a249fa97ea7dcd21110cd9a07e1b0` and catalog publication
`2a152441f24c4c0a81bdad190e3e507c` with `no-cache` mutable-root policy. The
[compact live-QA record](regional-distribution-live-qa-20260917.json) pins the
raw ignored report. Fresh-context Chromium and Firefox checks passed the
automatic first-visit tour and exact channels, clusters, Brain-Wide Map, W26
volume and processed AGEA releases. W26/AGEA regional companions loaded lazily
once and were reused across hemisphere changes; AGEA displayed the required
bilateral-averaging caveat. There were no console/page/HTTP errors or unexpected
failed requests. Firefox's one `NS_BINDING_ABORTED` for the decorative site
slices SVG is retained separately as an expected non-scientific cancellation.

The first two harness iterations are retained under the ignored deployment
artifact root. They captured, respectively, an assertion made before switching
W26 from bilateral to a single hemisphere and the same Firefox cancellation
before it was classified explicitly. Neither exposed a product or data error.

The tracked site configuration now pins the promoted catalog for future builds.
The deployed immutable site receipt correctly retains the prior catalog hash it
verified before the catalog-last promotion.
