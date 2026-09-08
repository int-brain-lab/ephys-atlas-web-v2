# Staging infrastructure change plan

Status: D074 authorizes the scoped deployment after validation. This remains an
offline operator proposal because the authenticated user was denied both OAC
and dedicated staging OAI creation; those attempts created no AWS resource.
No repository-managed artifact has been uploaded.

## Known state and proposed state

The 2026-09-08 read-only audit found production distribution
`ET6VJW8JWAGVR` at `d2is8oq6heobqy.cloudfront.net`. It uses the selected
production origin path and legacy OAI `E359S50BKNNGWZ`. It has no ordered cache
behaviors or route function. Both selected S3 environment roots were empty.
There is no known staging distribution or staging CloudFront bucket grant.

The D074-selected proposal creates a separate dedicated-OAI distribution over
the fixed staging origin path and starts on its generated `*.cloudfront.net` hostname. CloudFront
may read only `catalog.json`, `atlas/*`, `datasets/*`, and `site/*` below that
origin. It cannot read `_staging/*`, the production environment, or sibling
source aggregates. The production distribution and its OAI remain unchanged
while staging is created and tested.

The OAI exception preserves the shared bucket's observed ownership settings.
The OAC files remain a future alternative if a separately approved ownership
configuration satisfies its prerequisites. The exact administrator request and
denial evidence are in
[Atlas deployment access request](AWS_DEPLOYMENT_ACCESS_REQUEST.md).

The checked-in review inputs are:

| File | Purpose |
| --- | --- |
| `tools/deployment/staging-oai.json` | selected dedicated staging OAI creation draft |
| `tools/deployment/staging-cache-policy-mutable.json` | TTL-zero entry/catalog/index policy |
| `tools/deployment/staging-cache-policy-immutable.json` | one-year immutable policy with compression disabled |
| `tools/deployment/staging-cloudfront-distribution-oai.json` | selected isolated generated-hostname distribution draft |
| `docs/publishing/AWS_DEPLOYMENT_ACCESS_REQUEST.md` | exact OAI public-prefix grant and administrator operations |
| `tools/deployment/publisher-iam-policies.staging.json` | separate minimum policy drafts for benchmark, release, projection, mesh, site, and curator operations |
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

1. Resolve the already-authorized artifact inventory and generated-hostname
   staging templates. Record the responsible AWS administrator and temporary
   publisher credential profile without recording credentials.
2. Create the dedicated staging OAI and the two cache policies. Publish an exact copy of
   `site-router.js` as a CloudFront Function, record its ARN, and substitute only
   those created identifiers into the OAI distribution draft.
3. Create the isolated staging distribution. Record its ID and generated
   hostname. Merge only the OAI public-prefix statement from the access request
   into the existing bucket policy; do not replace existing statements or add
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
   this change. Apply the D074-authorized route and cache changes after staging
   validation, verify them, and then remove only the obsolete root `index.html`
   bucket-policy resource. Any OAI-to-OAC migration remains a later, separately
   reviewed operation.

## Volume benchmark path

The reviewed W26 depth-four artifact remains a scientifically labelled local
candidate. The current release publisher runs production preflight for staging
too, and production preflight correctly rejects `candidate` release IDs.
Renaming or relabelling those bytes would hide their maturity and is forbidden.

The implemented `tools.s3_publish --staging-benchmark` path preserves that
candidate identity, requires clean Linux/HEAD provenance and complete
schema/hash validation, rejects production and aliases, and never writes the
dataset index or curator-recognized completion record. It places immutable
candidate bytes below the existing staging `datasets/*/releases/*` public
prefix for exact-URL measurement and records `_benchmark_publication.json` so
the curator path rejects it. Use the exact transaction-scoped benchmark IAM
template and the command in [Local publisher operations](LOCAL_PUBLISHER.md).
The artifact is authorized by D074. Administrator-created infrastructure,
temporary scoped access and successful validation are still required before
applying the command or claiming a real-origin Q5 result.
