# AWS console and DNS setup

Status: runbook; D071 selects the production hostname. These are setup
instructions, not evidence that resources exist or permission to upload data.
Current publishing support and stop conditions are in
[S3 deployment](S3_DEPLOYMENT.md).

## 1. Gather access and identifiers

Use the IBL AWS account that owns `ibl-brain-wide-map-private`, not a personal
account. Ask its administrator for infrastructure access and a separate,
temporary, prefix-scoped publishing identity. Do not use root credentials.

Ask whoever manages `internationalbrainlab.org` to add DNS records. The domain
does **not** need to move to AWS or change nameservers. Production is
`ephys-atlas.internationalbrainlab.org`. Proposed staging is
`ephys-atlas-staging.internationalbrainlab.org`, pending owner confirmation;
the staging distribution's AWS hostname can be used initially instead.

Record account ID, distribution IDs/domain names, OAC IDs, certificate ARN,
DNS provider/contact and the selected credential profile in the deployment
record. Never record secrets. Create staging first; repeat for production only
after its browser/integrity evidence is accepted.

## 2. Request the HTTPS certificate

In **Certificate Manager**, select **US East (N. Virginia), us-east-1**. Choose
**Request certificate → Request a public certificate**, enter the exact
production hostname and choose DNS validation. Add the staging name as another
name only if confirmed, or use a separate staging certificate.

Open the pending certificate and copy its validation CNAME name/value to the
DNS administrator. In Route 53, use **Create records in Route 53** only if this
account actually owns the authoritative hosted zone. Wait for **Issued**.
Keep the validation records for automatic renewal. This certificate-validation
CNAME is distinct from the website traffic record added later.

CloudFront certificates must be in us-east-1 and cover the alternate hostname.
See [AWS certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

## 3. Keep the existing bucket private

In **S3 → ibl-brain-wide-map-private → Permissions**, inspect Block Public
Access, Object Ownership and existing bucket policy with the bucket owner.
Keep public access blocked; use the regular S3 REST endpoint, not S3 website
hosting. Do not replace existing policy statements or change bucket-wide
ownership/encryption settings without reviewing other users of this shared
bucket.

The environment roots are fixed:

```text
aggregates/atlas/ephys-atlas-web-v2/staging/
aggregates/atlas/ephys-atlas-web-v2/production/
```

No folder creation is needed: S3 creates prefixes when authorized objects are
uploaded. `_staging/` inside each environment is private transaction storage;
it is not the public staging website. Never allow CloudFront to read it.

## 4. Create the isolated CloudFront distribution

In **CloudFront → Distributions → Create distribution**, choose the existing
S3 bucket as origin. For staging, use origin path
`/aggregates/atlas/ephys-atlas-web-v2/staging` (no trailing slash). Configure:

- Origin access: **Origin access control**, create/select an S3 OAC and
  **Sign requests** (always).
- Viewer protocol: **Redirect HTTP to HTTPS**; read-only GET/HEAD methods.
- Alternate domain and matching certificate only when the staging name is
  confirmed; otherwise start with the generated `*.cloudfront.net` hostname.
- Do not configure global 403/404-to-200 HTML error responses: missing
  scientific resources must remain errors, not HTML disguised as data.
- Keep caching disabled initially. Add the reviewed immutable behaviors below
  before benchmarking the real origin.

Use a separate production distribution with the production origin path and
D071 hostname. Never add the staging origin to production as a fallback.
OAC and the bucket policy, not the origin path alone, enforce isolation.
See [AWS S3 origin access control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

### Bucket policy: merge narrow statements, not the generated bucket-wide grant

Have the bucket administrator merge this **staging-only statement** into the
existing policy, replacing the account and distribution placeholders. It
allows only the current public dataset/catalog/site paths. Add exact validated
projection/mesh pack prefixes when their publication layout is reviewed; do
not widen this to `staging/*` just to make an error disappear.

```json
{
  "Sid": "AtlasStagingCloudFrontRead",
  "Effect": "Allow",
  "Principal": {"Service": "cloudfront.amazonaws.com"},
  "Action": "s3:GetObject",
  "Resource": [
    "arn:aws:s3:::ibl-brain-wide-map-private/aggregates/atlas/ephys-atlas-web-v2/staging/catalog.json",
    "arn:aws:s3:::ibl-brain-wide-map-private/aggregates/atlas/ephys-atlas-web-v2/staging/datasets/*",
    "arn:aws:s3:::ibl-brain-wide-map-private/aggregates/atlas/ephys-atlas-web-v2/staging/site/*"
  ],
  "Condition": {"StringEquals": {
    "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT_ID:distribution/STAGING_DISTRIBUTION_ID"
  }}
}
```

Review existing statements for broader grants that could defeat this intended
boundary. Production uses its own statement, exact production paths and
production distribution ARN. Neither grant includes `_staging/`, private
administrative state, or sibling canonical source aggregates. If the bucket
uses SSE-KMS, review the exact key policy too; this guide does not select or
change encryption.

## 5. Configure routing and cache behavior

The site build is stored below `site/`; datasets stay below `datasets/` and the
catalog at `catalog.json`. Before site deployment, implement and test a narrow
viewer-request rewrite: `/` → `/site/index.html`; existing `/assets/*`,
`/brand/*`, and `/favicon.png` → their `/site/` counterparts. Preserve query
strings (the atlas uses URL query state), but do not forward them to S3 or
include them in the cache key. Do not rewrite arbitrary missing paths to HTML.
Other runtime asset URLs must be supplied by the reviewed build/catalog and
validated pack paths. This routing is a deployment requirement, not a deployed
or tested CloudFront Function in this implementation slice.

Set explicit cache behavior ordering, with mutable index rules ahead of broad
dataset rules. CloudFront matches behaviors before a viewer-request URI
rewrite; configure the behavior for the incoming public path as well as any
direct `/site/` path that is retained.

| Objects | Cache/header policy |
| --- | --- |
| `/`, entry HTML, catalog, dataset indexes | `Cache-Control: no-cache`; CloudFront minimum TTL 0, initially CachingDisabled |
| Content-hashed JS/CSS and immutable release/pack objects | `public,max-age=31536000,immutable`; never overwrite |
| Non-content-hashed favicon/brand assets | Revalidate; do not mark immutable |
| `.isvg.gz` and other encoded numeric payloads | Opaque bytes, `application/octet-stream`, **no Content-Encoding**, no CDN recompression |
| JSON | `application/json`; schema-declared stored-byte identity remains authoritative |

Disable CloudFront automatic compression on scientific artifact behaviors;
application JS/CSS compression can be considered separately. Use a custom
cache policy with minimum TTL 0 wherever origin `no-cache` must be honored.
First-party reads are same-origin; if external scientific clients need CORS,
add a read-only response-headers policy to public data behaviors and verify
`Access-Control-Allow-Origin` and exposed Range/ETag headers. Avoid editing
the shared bucket's CORS policy just to support this website.
See [AWS cache behavior settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html).

## 6. Add the website DNS record

After the certificate is issued and the distribution has the alternate domain
configured, copy its generated hostname, for example `dEXAMPLE.cloudfront.net`.

| DNS provider | Record for `ephys-atlas.internationalbrainlab.org` |
| --- | --- |
| Existing non-AWS provider | CNAME `ephys-atlas` → the exact production distribution hostname; start with TTL 300 if supported |
| Route 53 authoritative hosted zone | A alias → CloudFront distribution; also AAAA alias if distribution IPv6 is enabled |

Use the staging distribution target for a separately approved staging record.
Enter a hostname, not `https://...` or a URL path. Do not point the website at
the S3 bucket endpoint. If using Cloudflare DNS, start DNS-only rather than
adding another proxy/cache layer. No registrar or nameserver migration is
required. Keep the separate ACM validation CNAMEs.
See [AWS alternate-domain setup](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CreatingCNAME.html)
and [Route 53 CloudFront aliases](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html).

## 7. Grant the local release publisher narrowly scoped access

In **IAM**, have the administrator attach a policy to the temporary publisher
identity with `s3:ListBucket` restricted by `s3:prefix` to the selected
environment root and `s3:GetObject`/`s3:PutObject` restricted to its
`datasets/*` and `_staging/*` objects. The release command needs no catalog,
site, pack, delete, ACL, CloudFront or DNS mutation permissions. Keep staging
and production permissions separate. A missing object's HEAD may return 403
with prefix-limited permissions. The command then requires a successful
exact-prefix listing to prove absence; denied reads alone are never treated
as absence. An existing but unreadable object still fails closed.

The current command uses single-object PUTs with SHA-256 validation and
conditional headers, not multipart. It rejects objects above 5 GB before
network access. Add multipart/KMS permissions only if the corresponding
implementation or selected encryption requires them. Temporary authentication
instructions are in [S3 deployment](S3_DEPLOYMENT.md#terminal-authentication).
See [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

## 8. Stop before upload; then verify staging

Send the distribution identifiers, certificate ARN, DNS arrangement and scoped
policy for review. Authorize an exact Linux-built artifact set separately.
The current local candidate/preview bundle must not be relabelled production.

After an authorized upload, verify real-origin stored-byte SHA-256 and sizes,
MIME, Range 206, cache behavior, reloads and linked browser navigation. Test
anonymous S3 denial and CloudFront denial of `_staging/`, the other environment
and source prefixes. Only then complete curator catalog/edition promotion and
site deployment, freeze a reproducible HTTPS development bundle, and repeat
the accepted setup for production. Provisioning DNS/TLS alone does not make
the atlas launch-ready.
