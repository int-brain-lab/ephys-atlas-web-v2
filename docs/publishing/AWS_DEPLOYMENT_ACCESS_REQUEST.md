# Existing atlas website deployment access

Current status after administrator changes (2026-09-08): **no further request
needed for the direct deployment path**. Router creation/read/test/publication,
invalidation and S3 private write/readback/update succeeded. Conditional
UpdateDistribution/UpdateFunction probes reach ETag validation. Use available
GetDistribution/GetFunction reads instead of denied GetDistributionConfig/
DescribeFunction, and distribution-local cache settings. The request below is
historical context, not an outstanding action list. Actual data/site deployment
and distribution update remain pending; the LIVE router is not yet attached.


Status: revised direct first-deployment request, prepared locally and **not
sent**. Supersedes the earlier separate-staging setup request. D074 authorizes
the deployment; no additional owner approval is needed.

## Scope

Use only the existing website:

- account `842577843587`, distribution `ET6VJW8JWAGVR`;
- hostname `ephys-atlas.iblcore.org`, CloudFront `d2is8oq6heobqy.cloudfront.net`;
- existing OAI `E359S50BKNNGWZ`;
- bucket `ibl-brain-wide-map-private`, exact root
  `aggregates/atlas/ephys-atlas-web-v2/production/`.

No new staging identity/distribution, DNS, certificate, OAI migration, bucket
policy, ownership, ACL, encryption or other bucket-wide change is required.
Preserve all unrelated resources and settings.

## Confirmed blocker

On 2026-09-08, profile `ibl-atlas` authenticated as `iblmember` could read the
existing distribution through `cloudfront:GetDistribution`, including its
configuration and ETag. It was denied this actual operation:

```text
cloudfront:CreateFunction
arn:aws:cloudfront::842577843587:function/ephys-atlas-web-v2-production-router
Reason: no identity-based policy allows cloudfront:CreateFunction
```

The intended function rewrites only `/`, `/app` and `/app/` to
`/site/index.html`, preserving browser queries and data errors. Its exact code
is [site-router.js](../../tools/deployment/site-router.js). The failed request
created nothing. Evidence is in ignored `artifacts/deployment-direct-20260908/`.
Other production write permissions remain unverified; this denial does not
prove that uploads or distribution updates are denied.

## Requested administrator action

Create, test and publish that one function using runtime `cloudfront-js-2.0`,
then return its LIVE ARN and ETag. Creation may remain administrator-run;
there is no need to grant general CloudFront administration to `iblmember`.

The operator also needs scoped access to read/update distribution
`arn:aws:cloudfront::842577843587:distribution/ET6VJW8JWAGVR` and to inspect/test/
update/publish only that router function. Explicit cache invalidation, if used,
must also be limited to that distribution. Alternatively, the administrator
can apply the reviewed routing/cache configuration themselves.

The existing [production patch plan](../../tools/deployment/production-cloudfront-patch-plan.json)
defines the route/cache behavior: zero TTL for mutable entry/catalog/indexes,
immutable caching for versioned assets, no CDN compression of encoded scientific
bytes, and no HTML fallback for data errors. Its earlier staging prerequisite
is superseded by the D074 direct first-deployment amendment. If using its cache
policy variant, create only the two production-named policies from the existing
[mutable](../../tools/deployment/staging-cache-policy-mutable.json) and
[immutable](../../tools/deployment/staging-cache-policy-immutable.json) templates;
do not create staging copies or modify a shared policy. A configuration using
equivalent distribution-local TTL settings may avoid new cache policies, but
must receive the same route/cache validation before update.

Preserve the existing origin/path, OAI, alias and certificate. Save a fresh
configuration and ETag, review the exact diff and use the ETag on update. Keep
the prior configuration for rollback. Leave the obsolete root-index bucket
permission alone; removing it is not necessary for deployment.

For uploads, verify operation-specific S3 publisher permissions on the exact
production root, including private `_staging/` transaction/history objects.
Use the existing [publisher templates](../../tools/deployment/publisher-iam-policies.staging.json)
with only the environment root changed and dependency placeholders resolved.
CloudFront must still read only the already granted public paths. Do not grant
object deletion, bucket administration or wider `aggregates/atlas/*` access.
Prefer a temporary scoped role through the existing authentication process;
return role/profile instructions, never secret keys or tokens.

## Next execution

With routing and publisher access available, rebuild/preflight from clean Linux
`main`, publish the four approved releases and packs, promote the catalog, build
and publish the site, then verify actual HTTPS routing, integrity, MIME, Range,
cache and private-prefix denial plus browser behavior. Volumes stay outside the
catalog until Q5 real-origin evidence passes. The current candidate publisher
remains staging-only; direct-origin benchmark support must be implemented and
tested without relaxing ordinary production-release guards.
