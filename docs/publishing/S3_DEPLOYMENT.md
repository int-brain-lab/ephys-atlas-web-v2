# S3 deployment access and preflight

Status: runbook for the authorized S3 bucket and D059-selected environment
roots. This document records access evidence and safe operator commands; it
does not authorize publication of a particular release. Remaining delivery and
publication choices are governed by Q8 and Q9.

## Confirmed candidate location

- AWS Region: `us-east-1`
- private bucket: `ibl-brain-wide-map-private`
- existing scientific prefix: `aggregates/atlas/`
- staging root: `aggregates/atlas/ephys-atlas-web-v2/staging/`
- production root: `aggregates/atlas/ephys-atlas-web-v2/production/`
- planned initial viewer domain: `ephys-atlas.iblcore.org`

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
not itself a web-release root. Upload browser artifacts only below the exact
D059 staging or production child root; never place them alongside existing
source keys.

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

## Direct CLI versus the publishing service

Direct AWS CLI deployment is a viable operational choice; the launch spec does
not require the publishing service. The existing publishing service adds
resumable private staging, declared byte-size/SHA-256 checks, schema validation,
immutable publication, serialized mutations, and coordinated catalog/alias
updates behind revocable capability tokens. Its implemented storage backend is
filesystem-based, so using it with these S3 roots would require an
object-storage adapter.

A direct CLI workflow avoids that adapter but must replace those safeguards
with a reviewed deployment command or script: validate before upload, use
conditional create-only writes for immutable keys, recover multipart failures,
verify remote bytes and headers, and update mutable indexes only after every
referenced immutable object is available. Ad hoc `aws s3 sync` alone is not an
equivalent publication transaction.

## Deployment stop conditions

Before the first upload, Q8 must record:

1. whether direct S3 upload or a publishing adapter owns validation and
   publication;
2. how `ephys-atlas.iblcore.org` is hosted and how its browser reaches private
   S3 data, including the HTTPS data origin/path and DNS/TLS arrangement;
3. whether CloudFront supplies that boundary or D040 is explicitly revised;
4. MIME, CORS, Range, cache, and opaque `.isvg.gz` metadata rules;
5. the immutable-release promotion and mutable catalog/alias update procedure;
6. the first exact artifact set authorized for staging.

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

`<deployment-root>` is one of the two D059 environment roots. Projection and
mesh pack locations must follow their validated manifest identities and the
same immutable-object rules; this runbook does not invent parallel paths for
them.
