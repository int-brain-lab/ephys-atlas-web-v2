# S3 deployment access and preflight

Status: runbook for the authorized S3 bucket, D059-selected environment roots,
and D060-selected local-publisher/CloudFront topology. This document records
access evidence and safe operator commands; it does not authorize publication
of a particular release. Remaining deployment details and scientific release
choices are governed by Q8 and Q9.

## Confirmed candidate location

- AWS Region: `us-east-1`
- private bucket: `ibl-brain-wide-map-private`
- existing scientific prefix: `aggregates/atlas/`
- staging root: `aggregates/atlas/ephys-atlas-web-v2/staging/`
- production root: `aggregates/atlas/ephys-atlas-web-v2/production/`
- planned initial viewer domain: `ephys-atlas.iblcore.org`
- production delivery: one CloudFront distribution serving the compiled Vite
  viewer and same-origin public data from the private production namespace
- publication: operator-invoked local repository command; no always-on
  publishing server and no Cloudflare Pages deployment initially

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

## Selected local publication model

D060 selects an operator-invoked local repository publisher rather than a
hosted publishing service or ad hoc AWS CLI deployment. The command uses
temporary scoped AWS credentials and must reuse the implemented publishing
rules: resumable private staging, declared byte-size/SHA-256 checks, schema
validation, immutable publication, and coordinated catalog/alias updates. It
must operate only below an exact D059 environment root.

The current capability-token HTTP service remains filesystem-based and is not
deployed initially. Its validation and state-transition logic should be reused
or factored where practical, but the local S3 path does not need its WSGI API,
bearer tokens, reverse proxy, or server credential store. Ad hoc `aws s3 sync`
alone is not an equivalent publication transaction.

## Selected static hosting model

CloudFront serves both the Vite application and public artifacts from private
S3 at `ephys-atlas.iblcore.org`. Place the application below `site/` within the
selected environment root. Its entry document is mutable and short-lived or
revalidated; its content-addressed build assets are immutable and long-lived.
Schema-v1 catalogs/aliases remain separately mutable, while releases and packs
remain create-once.

Use S3 REST origins with Origin Access Control and scope the bucket policy to
the exact selected deployment root. The production distribution must not
expose the staging root or sibling canonical/source aggregates. A staging
distribution or equivalently isolated non-production boundary must be
provisioned before production. DNS may remain with its current provider; the
CloudFront custom-domain certificate belongs in ACM `us-east-1`.

## Deployment stop conditions

Before the first upload, Q8 must record:

1. exact staging and production CloudFront distributions, origin paths, OAC,
   and root-scoped bucket policy;
2. staging hostname plus production DNS and ACM/TLS arrangement;
3. MIME, CORS, Range, cache, and opaque `.isvg.gz` metadata rules;
4. minimum local-publisher IAM policy and credential/profile handling;
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
