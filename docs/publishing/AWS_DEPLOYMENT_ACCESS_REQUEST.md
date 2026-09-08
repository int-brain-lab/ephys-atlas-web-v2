# Atlas deployment access request

Status: prepared locally; **not sent**. Evidence date: 2026-09-08.

The repository owner has authorized the atlas deployment work described by
D074. The remaining issue is AWS access, not another request for owner approval.
Please have the account administrator perform the bounded setup below, then
provide temporary access to the resulting atlas resources and publisher paths.
Do not attach CloudFront administrator access to the shared `iblmember` user.

## Observed access

Account: `842577843587`. Local profile: `ibl-atlas`. Authenticated caller:
`arn:aws:iam::842577843587:user/iblmember`.

| Operation | Evidence |
| --- | --- |
| `sts:GetCallerIdentity` | Succeeded for the caller above. |
| `cloudfront:GetDistribution` | Succeeded for production `ET6VJW8JWAGVR`. |
| `cloudfront:GetDistributionConfig` | Access denied for that distribution. |
| `cloudfront:CreateOriginAccessControl` | Access denied; the attempt created no OAC. |
| `cloudfront:CreateCloudFrontOriginAccessIdentity` | Access denied for the dedicated staging attempt; it created no OAI. |
| `iam:SimulatePrincipalPolicy` | Access denied; simulation is not required for deployment. |
| `s3:GetBucketOwnershipControls` | `OwnershipControlsNotFoundError`; no explicit ownership controls were returned. |
| `s3:GetEncryptionConfiguration` | Default SSE-S3 (`AES256`), not SSE-KMS. |
| Conditional `s3:PutObject` at one private transaction key per environment | Both returned `NoSuchKey` for a deliberately impossible `If-Match`; neither created an object. This tests those exact requests, not every publisher operation. |

Cache/function/distribution creation, distribution updates,
bucket-policy updates, and complete publisher transactions have **not** been proved allowed
or denied by those results. Do not describe all CloudFront writes as denied.
`GetDistribution` also returns configuration and an ETag, so the separate
`GetDistributionConfig` denial does not itself prevent obtaining that snapshot.

Production is `arn:aws:cloudfront::842577843587:distribution/ET6VJW8JWAGVR`,
hostname `d2is8oq6heobqy.cloudfront.net`, alias `ephys-atlas.iblcore.org`, with
OAI `E359S50BKNNGWZ`. Keep that origin, alias, certificate and OAI unchanged.

## Origin access prerequisite

Bucket: `ibl-brain-wide-map-private`, Region: `us-east-1`. Preserve its ownership,
ACL, encryption, public-access-block, CORS and other bucket-wide settings.
The existing OAC template is not ready to apply against the observed ownership
configuration: AWS requires Bucket owner enforced, or Bucket owner preferred
when ACLs are needed. No ownership change is authorized. AWS documents OAI as
a legacy alternative, including a bucket-policy principal for it; OAI does not
support SSE-KMS. See [AWS origin access prerequisites and OAI support](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

The bounded alternative is a **new OAI used only by the new staging
distribution**, preserving the existing bucket settings. Before taking that
path, the administrator must verify that the atlas publisher operates in the
bucket owner's account and that the new objects can be read through OAI without
an ACL or encryption change. In particular, check actual/default encryption;
existing production OAI configuration alone does not prove staged objects are
compatible. If these checks fail, report the exact constraint rather than
changing shared bucket settings. Record the staging OAI exception in the
applicable deployment decision before applying its variant; this document does
not silently replace the OAC policy in D060.

## Administrator operations

Perform setup with the administrator's existing privileges. Return created IDs,
ARNs and configuration evidence; never send secret keys or session tokens.

1. Resolve [`staging-oai.json`](../../tools/deployment/staging-oai.json) with a
   recorded unique caller reference, remove `_template`, and create the dedicated
   staging OAI. Retain its returned ID and canonical user ID. Do not
   reuse production OAI `E359S50BKNNGWZ`.
2. Create the two cache policies from
   [`staging-cache-policy-mutable.json`](../../tools/deployment/staging-cache-policy-mutable.json)
   and
   [`staging-cache-policy-immutable.json`](../../tools/deployment/staging-cache-policy-immutable.json).
   For production, create separately named copies with `staging` replaced by
   `production`; do not mutate any previously shared policy.
3. Create `ephys-atlas-web-v2-staging-router` and
   `ephys-atlas-web-v2-production-router`, runtime `cloudfront-js-2.0`, using the
   exact committed [`site-router.js`](../../tools/deployment/site-router.js).
   Test and publish each function to LIVE. Record function ARNs, code hashes
   and the returned ETags.
4. Resolve
   [`staging-cloudfront-distribution-oai.json`](../../tools/deployment/staging-cloudfront-distribution-oai.json)
   with the staging OAI ID, policy IDs, LIVE function ARN and unique caller
   reference; remove `_template` and pass its `DistributionConfig` to
   `create-distribution`. This variant changes only the original OAC origin
   fields to `S3OriginConfig.OriginAccessIdentity`; all other settings match the
   [OAC template](../../tools/deployment/staging-cloudfront-distribution.json).
   Leave the exact staging origin path, generated AWS hostname, HTTPS redirect,
   GET/HEAD methods and ordered routing/cache behaviors intact. No DNS, ACM,
   public bucket, or HTML-on-error fallback is required. Retain the returned
   distribution ID, hostname, config and ETag.
5. In a coordinated bucket-policy edit, merge only the statement below into a
   freshly read policy. Preserve all existing statements and production OAI
   resources. Save before/after policy hashes and compare the resulting diff.
   This must be a manual scoped merge, not the console's blanket automatic
   bucket-policy update. `_staging/*` transaction objects remain private.
6. After staging delivery checks pass, fetch a fresh production configuration
   and ETag. Apply only the changes in
   [`production-cloudfront-patch-plan.json`](../../tools/deployment/production-cloudfront-patch-plan.json),
   substituting the production policy IDs and LIVE router ARN. Use the current
   ETag for the update. Preserve the production OAI and all unrelated fields.
   Keep the old config for recovery; record the exact before/after diff. This
   request includes no production OAI migration or production bucket grant edit.

For step 5, replace the single OAI placeholder; this is one statement, **not a
complete bucket policy**. The OAI principal is identity-scoped, unlike the OAC
variant's distribution-ARN condition. Do not add an OAC `AWS:SourceArn`
condition to this OAI statement and assume it will work.

```json
{
  "Sid": "AtlasStagingOAIRead",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity <STAGING_OAI_ID>"
  },
  "Action": "s3:GetObject",
  "Resource": [
    "arn:aws:s3:::ibl-brain-wide-map-private/aggregates/atlas/ephys-atlas-web-v2/staging/catalog.json",
    "arn:aws:s3:::ibl-brain-wide-map-private/aggregates/atlas/ephys-atlas-web-v2/staging/atlas/*",
    "arn:aws:s3:::ibl-brain-wide-map-private/aggregates/atlas/ephys-atlas-web-v2/staging/datasets/*",
    "arn:aws:s3:::ibl-brain-wide-map-private/aggregates/atlas/ephys-atlas-web-v2/staging/site/*"
  ]
}
```

`PutBucketPolicy` operates on the whole bucket policy, not a prefix. Keep that
permission with the administrator; a prefix-scoped object policy cannot limit
it to editing one statement. Coordinate the read/merge/write window to avoid
replacing another administrator's concurrent changes. See [AWS PutBucketPolicy](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutBucketPolicy.html).

If a future separately authorized ownership configuration supports OAC, use the
existing [`staging-oac.json`](../../tools/deployment/staging-oac.json) and
[`staging-bucket-policy-statement.json`](../../tools/deployment/staging-bucket-policy-statement.json)
instead of the OAI substitutions, with its exact staging distribution ARN.
Do not create both origin identities as an access experiment.

## Temporary operator access after creation

Prefer an administrator-created, short-session role, trusted only to the
approved operator identity. Supply its exact role ARN and matching
`sts:AssumeRole` permission through the existing authentication process.
Keep resource creation and bucket-policy mutation with the administrator.
The role needs no IAM administration, DNS, ACL, bucket configuration or delete
permissions. An allowed policy cannot override an SCP, permissions boundary,
resource-policy denial or restrictive session policy; the administrator must
resolve any such denial within the same resource scope.

Use exact returned IDs, not `distribution/*` or `function/*`:

| Purpose | IAM actions | Resources |
| --- | --- | --- |
| Inspect/update routes and cache associations | `cloudfront:GetDistribution`, `cloudfront:GetDistributionConfig`, `cloudfront:UpdateDistribution` | Exact staging distribution ARN and production `arn:aws:cloudfront::842577843587:distribution/ET6VJW8JWAGVR` |
| Inspect/test/publish router changes | `cloudfront:DescribeFunction`, `cloudfront:GetFunction`, `cloudfront:TestFunction`, `cloudfront:UpdateFunction`, `cloudfront:PublishFunction` | Exact two router function ARNs |
| Inspect fixed cache policy definitions | `cloudfront:GetCachePolicy`, `cloudfront:GetCachePolicyConfig` | Exact four newly created cache-policy ARNs |
| Verify deployment and explicit cache purge, if needed | `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` | Exact two distribution ARNs |

The creation actions `CreateCachePolicy`, `CreateCloudFrontOriginAccessIdentity`,
`CreateOriginAccessControl`, `CreateFunction` and `CreateDistribution` do not
support individual-resource ARN scope. Keeping them administrator-run avoids
an account-wide creation grant to `iblmember`. Function/distribution creation
supports request tags, but tags do not restrict configuration fields. Likewise,
`UpdateDistribution` grants updates to the whole named distribution; IAM does
not restrict it to the reviewed route fields. If that scope is too broad,
keep production updates administrator-run. Resource/action mappings were
checked against the [AWS CloudFront authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

For S3 publication, use the operation-specific `PolicyDocument` entries in
[`publisher-iam-policies.staging.json`](../../tools/deployment/publisher-iam-policies.staging.json),
not its wrapper. Resolve site dependency placeholders to exact accepted object
ARNs/prefixes. Keep release, projection, mesh, site and curator permissions
separate where practical. Grant production in a separate role/session by
replacing only the exact environment prefix after staging evidence is accepted:

- staging: `aggregates/atlas/ephys-atlas-web-v2/staging/`;
- production: `aggregates/atlas/ephys-atlas-web-v2/production/`.

The existing templates restrict `s3:ListBucket` with `s3:prefix` and object
reads/writes with resource ARNs. They need no object deletion, ACL writes,
multipart upload, or KMS permissions for the currently implemented publisher.
Do not widen them to `aggregates/atlas/*`. See [local publisher operations](LOCAL_PUBLISHER.md)
for immutable conditional writes, staging transactions and catalog promotion.

## Return evidence and next execution step

Return the staging distribution ID/hostname, dedicated origin identity ID,
policy IDs, LIVE function ARNs, before/after configuration and bucket-policy
diffs, and temporary role/profile instructions. Identify any operation that
remains denied with the exact action/resource and explicit-deny source when
available. Policy simulation is optional; no simulator grant is requested.

The operator then runs clean-Linux release preflight, publishes the exact
accepted artifact set, and verifies real-origin SHA-256/size, MIME, Range,
cache/routing behavior and private-prefix denial before production cutover.
Infrastructure permissions do not select scientific releases, paper defaults,
or waive Q2/Q5/Q9/Q19. Keep the evidence in the deployment record.
