# Initial live deployment — 2026-09-08

Status: frozen evidence for the initial D074 IBL review deployment. The landing
and viewer are live at `https://ephys-atlas.iblcore.org/` and `/app/`, with five
catalogued datasets. This records the deployed site build below; it does not
declare a final paper freeze or completion of broad launch QA.

The owner-approved direct-deployment amendment used the existing v2 origin for
initial validation. V1 was left untouched. Changes remained within the v2
production distribution and `aggregates/atlas/ephys-atlas-web-v2/production/`
namespace; no separate staging distribution was required. DNS, ACM, the bucket
policy, bucket-wide settings and the production OAI were preserved.

## Live site and delivery boundary

| Item | Recorded value |
| --- | --- |
| Distribution | `ET6VJW8JWAGVR` — `d2is8oq6heobqy.cloudfront.net`, status `Deployed` |
| Alias | `ephys-atlas.iblcore.org` |
| Private S3 origin | `ibl-brain-wide-map-private.s3.amazonaws.com` |
| Origin path | `/aggregates/atlas/ephys-atlas-web-v2/production` |
| Origin identity | OAI `E359S50BKNNGWZ`; no OAC migration |
| Viewer-request router | `arn:aws:cloudfront::842577843587:function/ephys-atlas-web-v2-production-router` |
| Site source commit | `db87240f2cb30d76f593b0538377d6d8e299686d` |
| Immutable site build | `9fbcf5935cfe344374f9c0c84c2f35b8` |
| Site publication transaction | `6333a0caa655ea596b2954fdf571cd26b01e39d652134f9c646e71231ba21f68` |

Only `DefaultRootObject`, `DefaultCacheBehavior` and `CacheBehaviors` changed
in the distribution configuration. The router serves the shared site entry for
`/`, `/app` and `/app/`. The mutable entry/catalog/index behaviors have zero
TTLs; immutable site builds, release directories, packs and the isolated volume
benchmark namespace have one-year default/maximum TTLs. Minimum TTL remains
zero. CDN compression is disabled, queries/cookies are not forwarded, and
GET/HEAD requests redirect HTTP to HTTPS. There are no custom HTML error
responses.

Final delivery checks at 14:05 UTC returned HTTP 200 for `/` and `/app/`, both
7,429 bytes with served SHA-256
`1d1447447d0a8ba28a51aa29612d2fd148d4811b0a135634e5b4884591ba09d6`
and `Cache-Control: no-cache`. The served entry includes the publisher's unique
publication comment, so its hash differs from the immutable build's original
`index.html`. The final build also serves the pinned Allen region metadata
inside its immutable site directory; its SHA-256 is
`aa5615bdf76493a815ad20bd77441998415b13272bc58101cd8da674848ed3ad`.

An existing private `_staging/access-audit/` object returned HTTP 403 through
CloudFront. Anonymous direct S3 access to an existing published channel manifest
also returned 403. A missing scientific resource returned XML 403, not site
HTML. These checks establish the tested private boundaries; they are not a
claim to have audited every bucket object.

## Published scientific artifacts

All four releases and both packs were built on clean Linux `main` at
`62199f51d81a7833480c64559930cdec9993f702`, with creation timestamp
`2026-09-08T13:09:12Z`, Python 3.12.3 and NumPy 2.5.2 on x86_64. Scientific pins
were `ibleatools` `9bfa0623a16bc7a989a6b27a589887641beee0a8` and `iblatlas`
`52083adf44825d0622a503705e095699a5957587`. Each release passed production
preflight before publication and records `paper_snapshot: false`.

| Dataset | Immutable release | Features | Manifest bytes | Manifest SHA-256 |
| --- | --- | ---: | ---: | --- |
| Channels | `2026_W32-ibl-review-20260908-v1` | 70 | 41,590 | `77da1a8c0b192b0c338595e4db9628ebea0ae715d4593df764d22c5261fcb3b6` |
| Clusters | `sha256-9b5e55215b306f26-ibl-review-20260908-v1` | 14 | 14,130 | `c28936c8819c4e7f06f31afe69bf71a94b5f52d530e2c269dfc79a216f4f2c6c` |
| Brain-Wide Map | `legacy-v1-1d908bea-ibl-review-20260908-v1` | 30 | 20,988 | `ae03114ff1544c91a27b7d3ad9cc2fc06d690cb4bfcc93a5d9a495fe919fdb6a` |
| AGEA | `agea-original-20260908-v1` | 4,345 | 2,033,446 | `80f61920fa53e17ad1908075984460e1d8fd5f50b259ec9abc6617b8f781c383` |

The rebuilt channels, clusters and Brain-Wide Map matched every non-root-
manifest file in their reviewed releases: 1,137, 263 and 153 files respectively.
AGEA uses D074's original values, measured nonnegative voxels valid, `-1`
missing and unchanged affine; provisional processing/registration notes appear
only in Data details. Publication does not resolve Q19's final scientific review.

| Pack | Immutable ID | Manifest bytes | Manifest SHA-256 |
| --- | --- | ---: | --- |
| Projections | `ibl-atlas-projections-05b9f3f85db9` | 7,432 | `5c6ad6fb49b8ad9281c954c3fc7948300997b60b98097043dbe6d26ddc5b8a46` |
| D070 anatomy | `ibl-native-d070-71f78c56e0b35eb2` | 682,717 | `2a2b9145b09f67d175a9ce0d7dbcc9e63a2c0444218e06c86902d19378e8dc9d` |

The D070 geometry resource retains SHA-256
`b5f5abc7d0bb357520a65dacf33a24251e2bd6f75873d7d5ac650ef2cd271799`,
966,645 source triangles and 1,140 components. HTTP checks verified pack
manifest hashes, opaque numeric MIME, immutable caching and Range 206 delivery.

The initial four-dataset catalog publication ID was `2633687dfd9349faba52d1c44ad77572`; served
`catalog.json` is 3,202 bytes, SHA-256
`366ead7f0fc18a3696b537bd1486c0f1aaa4700e540e5f0a81e5c04864f00710`.
The edition is `ibl-review-20260908-v1`. The configured initial view is Ephys
Atlas channels, `rms_ap.denoised`, Allen parcellation and linked 2-D slices.

## Checks and limitations

The final site commit passed `just check` and
[CI run 34236039518](https://github.com/int-brain-lab/ephys-atlas-web-v2/actions/runs/34236039518).
The preceding site/default commit `f02afa5` also passed its full local gate and
[CI run 34234213753](https://github.com/int-brain-lab/ephys-atlas-web-v2/actions/runs/34234213753).
Local gate logs are `/tmp/atlas-live-delivery-fixes-check.log` and
`/tmp/atlas-initial-site-check.log`; scientific release preflight is retained in
the deployment `build.log`.

[Compact live QA evidence](initial-live-qa-20260908.json) pins the raw reports
and 21 screenshots. Chromium passed the landing, default/deep-link, four-dataset,
download, local Brain-Wide Map import and optional 3-D workflows. Firefox
completed the same applicable 2-D workflows, including AGEA and local import.
Its unchanged strict raw report failed on six `NS_BINDING_ABORTED` requests
from contexts superseded by subsequent navigation; the compact record preserves
these expected cancellations separately from HTTP, console and page errors.
This is not presented as a clean raw Firefox diagnostic pass. Firefox headless
3-D was not attempted because the Linux WebGL driver lacks the required support.

Landing checks at desktop, tablet, 320 px and 390 px confirmed contained layout
and no scientific fetch. The deployment operator visually reviewed desktop,
320 px, AGEA and 3-D captures without finding layout issues. Recorded startup
timings use explicit reused-context/cache conditions; they are observations,
not release performance thresholds or Q5 measurements.

## Production ephys volumes and final catalog

D075 selects depth-four orthogonal slice packs from the
[real CloudFront benchmark](../../benchmarks/rendering/volume-origin-20260908/README.md).
The 180 actual-slider trials pass; the 41-feature sweep renders every feature,
moves within a pack without requests, and crosses a boundary with one request.
Worst per-feature slider p95 is 90.6 ms under 80 ms/10 Mbps; worst startup p95
is 2.891 s. Earlier speculative-prefetch and URL-restoration findings remain
separate frozen diagnostics, not silently removed measurements.

Production release `2026_W26-ibl-review-20260908-v1` was built on clean Linux
`main` at `2be9ec9d693f0b9e04685a54403daf44b61ada70`, created
`2026-09-08T14:45:12Z`, with the same scientific package/environment pins above.
Its 6,810 files total 494,885,595 bytes. The 24,142-byte manifest has SHA-256
`16be30752447b3d99411ac982e7ed0e49f2b1d4f6a5d11c3ceeefb11c946fa7e`.
All 6,809 non-manifest files are byte-identical to the tested candidate; the
6,683 numeric resources also match the reviewed local release. The manifest
records the new production identity and actual build provenance. Production
preflight passed before the ordinary release transaction
`c915eb24196558713eae74df5758ff2c9c07b3726f7502bd7161c1ef3e6b7f93`.
Publication and complete-catalog verification finished successfully in 396.3 s
and 249.7 s respectively.

The final public catalog has publication ID `9889b3a083b243a7ab9d61a4309fe719`,
4,058 bytes and SHA-256
`ef5566f80f77d25e70127da07bcd0de63f7655e4f63008af0d91134d24e5a1ab`.
It exposes all five datasets. New Ephys Atlas edition `ibl-review-20260908-v2`
adds volumes, while the already exposed v1 edition mapping remains unchanged.
Channels `rms_ap.denoised`, Allen and linked 2-D remain the initial default.
The existing site reads this mutable catalog; adding volumes did not require
another site build. The tracked site configuration now pins the final catalog
for future builds, while the immutable deployed receipt retains its original
publish-time dependency.

Production HTTPS checks validate the manifest, one descriptor/index and the
three center packs by exact size/SHA, with immutable caching, opaque gzip,
Range 206 byte equality and non-HTML missing-resource denial. The browser and
all data use the same HTTPS origin; no cross-origin CORS allowance is claimed.
The [compact production release record](production-volume-release-20260908.json)
pins the build, numeric comparison and publication evidence. Detailed new
evidence is in ignored `production-volumes/` under the deployment
artifact root: build session, command, validated inventory, scientific
comparison, publication receipts, catalog bytes and `production-http.json`.
A bounded signature scan of 1,128 tracked files and the 18 newly committed files
found no private-key, AWS-key-ID or classic GitHub-token signatures. This is
not an exhaustive secret detector; deployment authentication uses the external
AWS profile. The ignored `secret-signature-audit.json` records its scope.

The new source/configuration commit passes full `just check` and
[CI run 34240283516](https://github.com/int-brain-lab/ephys-atlas-web-v2/actions/runs/34240283516).

[Final live volume checks](final-volume-live-qa-20260908.json) pass in both
Chromium and Firefox against the real catalog with no route interception or
console, page, request or HTTP errors. They verify the unchanged channel
default, volume chooser/41-feature inventory, three composite panes, native
slider movement and retained v1 edition links. The operator visually reviewed
both volume screenshots. Two initial harness assumptions (fetching from
`about:blank` and requiring a redundant default-feature URL parameter) were
corrected and their failed reports retained. General native Safari on the final
origin remains unmeasured before wider promotion. The
initial IBL review deployment does not claim a final paper freeze or completed
Q19 scientific acceptance.


## Recovery and retained evidence

Use the existing [local publisher](LOCAL_PUBLISHER.md) for recovery. Restore a
reviewed source/default configuration on clean `main`, build a new immutable
site with current provenance and verified dependency hashes, then publish it
through the conditional `site/index.html` transaction. Keep old build directories
for existing browser sessions. Do not bypass preflight or overwrite immutable
site/release bytes to reuse an old identity.

Catalog recovery uses curator compilation and a new publication/history ID,
retaining immutable edition mappings and all prior history. A routing rollback
uses a fresh distribution ETag and restores only the recorded root/cache/router
changes from the saved before configuration, preserving unrelated changes.
Neither recovery path requires deleting scientific releases or modifying v1.

Detailed operator evidence is retained locally under
`artifacts/deployment-live-20260908/`: `artifact-inventory.json`, `build.log`,
`publication/`, `cloudfront-before.json`, `cloudfront-diff.json`,
`cloudfront-live.json`, `cloudfront-scope-verification.json`,
`private-boundary-http.json`, `catalog-http.json`, `pack-http.json`,
`agea-http.json`, `site-delivery-fix/_site.json`,
`site-delivery-fix-publication.json` and `site-delivery-fix-http.json`.
Earlier `site-http.json` and the scope-verification file's site-build field
refer to the superseded first site build, not the final build recorded here.
These raw artifacts are ignored local evidence; this document and the compact
QA record retain the durable deployment identities and conclusions.
