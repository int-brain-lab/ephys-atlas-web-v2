# Staging infrastructure change plan

Status: offline proposal for owner and IBL AWS administrator review. Nothing in
this plan records an AWS mutation or authorizes an artifact upload.

## Known state and proposed state

The 2026-09-08 read-only audit found production distribution
`ET6VJW8JWAGVR` at `d2is8oq6heobqy.cloudfront.net`. It uses the selected
production origin path and legacy OAI `E359S50BKNNGWZ`. It has no ordered cache
behaviors or route function. Both selected S3 environment roots were empty.
There is no known staging distribution or staging CloudFront bucket grant.

The proposal creates a separate OAC-backed distribution over the fixed staging
origin path and starts on its generated `*.cloudfront.net` hostname. CloudFront
may read only `catalog.json`, `atlas/*`, `datasets/*`, and `site/*` below that
origin. It cannot read `_staging/*`, the production environment, or sibling
source aggregates. The production distribution and its OAI remain unchanged
while staging is created and tested.

The checked-in review inputs are:

| File | Purpose |
| --- | --- |
| `tools/deployment/staging-oac.json` | S3 SigV4 OAC creation input |
| `tools/deployment/staging-cache-policy-mutable.json` | TTL-zero entry/catalog/index policy |
| `tools/deployment/staging-cache-policy-immutable.json` | one-year immutable policy with compression disabled |
| `tools/deployment/staging-cloudfront-distribution.json` | isolated generated-hostname distribution draft |
| `tools/deployment/staging-bucket-policy-statement.json` | staging public-prefix read statement to merge into the shared bucket policy |
| `tools/deployment/publisher-iam-policies.staging.json` | separate minimum policy drafts for release, projection, mesh, site, and curator operations |
| `tools/deployment/production-cloudfront-patch-plan.json` | exact later routing/cache changes for existing production, retaining its OAI |

Files marked `offline-proposal-not-cli-ready` contain required placeholders
and a wrapper that AWS APIs do not accept. Resolve every placeholder from the
created resources, remove only the documented wrapper, obtain review, and then
use the resulting request. Do not substitute guessed IDs.

## Cache and route contract

The default behavior has TTL zero and associates the published form of
`tools/deployment/site-router.js`. The function maps only `/`, `/app`, and
`/app/` to `/site/index.html`; it leaves queries on the viewer request and does
not rewrite missing data. CloudFront chooses an ordered cache behavior before
the viewer-request function changes the URI. The incoming public routes
therefore need the TTL-zero default behavior, while direct `site/index.html`
has its own TTL-zero behavior.

`catalog.json` and `datasets/*/index.json` are mutable. Their rules precede the
broad immutable release rule. A generic `*.json` mutable rule would be wrong
because release and pack JSON is hash-bound immutable content. Site builds,
dataset releases, and atlas packs use the one-year policy. Both cache policies
exclude query strings, cookies, and headers from the cache key and origin
request. Compression is disabled, including for `.isvg.gz` and numeric payloads,
so CloudFront cannot change the stored-byte representation used by integrity
checks. The same-origin site needs no CORS response-headers policy. Verify Range
and any later cross-origin requirement from the actual origin rather than
changing shared-bucket CORS speculatively.

## Proposed operation order

1. Review the templates, the generated-hostname staging choice, and the exact
   first staging artifact set. Record the responsible AWS administrator and
   temporary publisher credential profile without recording credentials.
2. Create the OAC and the two cache policies. Publish an exact copy of
   `site-router.js` as a CloudFront Function, record its ARN, and substitute only
   those created identifiers into a reviewed copy of the distribution draft.
3. Create the isolated staging distribution. Record its ID and generated
   hostname. Merge the staging statement into the existing bucket policy using
   that exact distribution ARN; do not replace existing statements or add
   `_staging/*`.
4. Before upload, prove anonymous S3 access is denied, CloudFront cannot read
   `_staging/*`, production, or sibling source prefixes, and missing objects
   remain 403/404 rather than returning HTML.
5. On clean Linux `main`, build the authorized immutable artifacts and run the
   applicable validators and production release preflight. Use one temporary
   per-operation IAM policy at a time. The current publisher's shared
   `_staging/<transaction-id>/` layout is why release/pack/site policies cannot
   narrow that private transaction subtree further without a code change.
6. Publish validated projection/mesh dependencies and releases. Each command
   promotes its public immutable objects only after its private transaction is
   complete; release dataset indexes remain TTL-zero. Compile and conditionally
   promote the authorized curator catalog after every referenced release is
   present. Publish the immutable site build and conditionally update
   `site/index.html` last.
7. At the generated staging hostname, verify stored-byte size and SHA-256,
   content type, absent `Content-Encoding` on opaque encoded artifacts, Range
   `206`, mutable revalidation, immutable cache headers, reloads, `/app/` query
   navigation, linked slices, and failure behavior. Record results against the
   exact distribution configuration and release commit.
8. After staging evidence is accepted, prepare an ETag-bound update for
   production distribution `ET6VJW8JWAGVR` from
   `production-cloudfront-patch-plan.json`. Keep OAI `E359S50BKNNGWZ` during
   this change. Apply the route and cache changes only after separate owner
   review, verify them, and then remove only the obsolete root `index.html`
   bucket-policy resource. Any OAI-to-OAC migration remains a later, separately
   reviewed operation.

## Volume benchmark stop condition

The reviewed W26 depth-four artifact remains a scientifically labelled local
candidate. The current release publisher runs production preflight for staging
too, and production preflight correctly rejects `candidate` release IDs.
Renaming or relabelling those bytes would hide their maturity and is forbidden.

Before Q5 can use the staging origin, review and implement a staging-only
benchmark publication path. It must preserve the candidate identity, require
clean Linux/HEAD provenance and complete schema/hash validation, prevent a
production destination, and avoid curator/default promotion. Whether that path
uses a dedicated public `benchmarks/*` namespace or a non-catalogued staging
dataset release is still an operational choice. Until it is selected and
tested, staging infrastructure and an authorized landing/site build can
progress, but no real-origin Q5 result can be claimed.
