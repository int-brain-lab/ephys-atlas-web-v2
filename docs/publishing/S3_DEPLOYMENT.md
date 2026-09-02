# S3 deployment access and preflight

Status: runbook for the authorized candidate S3 location. This document records
access evidence and safe operator commands; it does not select a staging or
production origin and does not authorize publication of a particular release.
Those choices remain governed by Q8 and Q9.

## Confirmed candidate location

- AWS Region: `us-east-1`
- private bucket: `ibl-brain-wide-map-private`
- existing scientific prefix: `aggregates/atlas/`

On 2026-09-02, an authorized IAM user authenticated from the repository host
with temporary console-derived credentials. The following checks succeeded:

- authenticated `ListObjectsV2` below `aggregates/atlas/`;
- `HeadObject` on an existing object;
- a non-mutating `PutObject` authorization probe against an existing key with
  `If-None-Match: *`, which returned `412 PreconditionFailed` as expected;
- a second `HeadObject` confirming unchanged size, ETag, and modification time.

Anonymous listing returned `403 AccessDenied`. The inspected object used
SSE-S3 (`AES256`); that observation does not establish the bucket's default
encryption policy. No object was created, replaced, or deleted. Delete access,
bucket administration, multipart recovery permissions, CORS, cache policy,
CloudFront behavior, and public reads were not verified.

`aggregates/atlas/` already contains canonical/source aggregate products. It is
not itself an approved web-release root. Do not upload browser releases or
packs alongside those inputs until Q8 names a distinct deployment root and its
staging/production semantics.

## Terminal authentication

Use AWS CLI v2.32.0 or newer and temporary console-derived credentials. The IAM
identity needs the AWS-managed `SignInLocalDevelopmentAccess` policy in
addition to its scoped S3 permissions. `ibl-atlas` is only the current local
profile convention:

```bash
aws login --profile ibl-atlas --region us-east-1
aws sts get-caller-identity --profile ibl-atlas
```

The login cache and `~/.aws/config` are workstation state. Never commit access
keys, refresh tokens, authorization codes, account-specific credential files,
or copied command output containing credentials.

Minimum practical S3 permissions for a selected deployment root are:

- `s3:GetBucketLocation` on the bucket;
- `s3:ListBucket` restricted by `s3:prefix` to the selected root;
- `s3:GetObject` and `s3:PutObject` on objects below that root;
- `s3:AbortMultipartUpload` and `s3:ListMultipartUploadParts` below that root
  for recoverable large uploads.

Do not add `s3:DeleteObject`, ACL, bucket-configuration, or wildcard `s3:*`
permissions unless a separately reviewed operation requires them. If the
selected destination uses a customer-managed KMS key, scope the required KMS
permissions to that exact key; the current evidence does not select one.

## Read-only access check

These commands do not download an object body or mutate S3:

```bash
aws s3api get-bucket-location \
  --bucket ibl-brain-wide-map-private \
  --profile ibl-atlas

aws s3api list-objects-v2 \
  --bucket ibl-brain-wide-map-private \
  --prefix aggregates/atlas/ \
  --max-items 10 \
  --profile ibl-atlas
```

Use `head-object` on an exact reviewed key to inspect size, ETag, content type,
cache metadata, and server-side encryption without transferring its body.

## Deployment stop conditions

Before the first upload, Q8 must record:

1. whether this bucket is approved for staging, production, or neither;
2. the exact new deployment root below the bucket, kept separate from existing
   scientific source aggregates;
3. whether direct S3 upload or a publishing adapter owns validation and
   publication;
4. the CloudFront distribution/domain and S3 REST-origin access boundary;
5. MIME, CORS, Range, cache, and opaque `.isvg.gz` metadata rules;
6. immutable-release and mutable catalog/alias update procedures.

Do not use `aws s3 sync --delete`. Do not overwrite an immutable release key.
Validate the complete local schema-v1 or pack graph, byte sizes, and SHA-256
values before upload. Stage new immutable bytes under a unique selected root,
verify the served bytes at the real HTTPS origin, and expose or update mutable
indexes only through the publication procedure chosen by Q8.

The schema-v1 public layout remains:

```text
<deployment-root>/
  catalog.json
  datasets/<dataset>/
    index.json
    releases/<release>/
      manifest.json
      ... declared immutable resources ...
      _publication.json
```

`<deployment-root>` is intentionally unresolved. Projection and mesh pack
locations must follow their validated manifest identities and the same
immutable-object rules; this runbook does not invent parallel paths for them.

