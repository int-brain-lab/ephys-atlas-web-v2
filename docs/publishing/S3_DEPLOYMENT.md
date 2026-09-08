# S3 deployment access and preflight

Direct first-deployment update (D074, 2026-09-08): a separate staging identity
and distribution are optional. The active path uses the existing atlas origin;
see [the reduced access request](AWS_DEPLOYMENT_ACCESS_REQUEST.md). References
below to required staging setup describe the earlier isolated-staging path.


Status: runbook for the authorized S3 bucket, D059-selected environment roots,
and D060-selected local-publisher/CloudFront topology. This document records
access evidence and safe operator commands; it does not authorize publication
of a particular release. Remaining deployment details and scientific release
choices are governed by Q8 and Q9. The console/DNS walkthrough is
[AWS console setup](AWS_CONSOLE_SETUP.md).
Implemented commands and recovery semantics: [Local publisher operations](LOCAL_PUBLISHER.md).
The concrete offline templates and ordered proposal are in
[Staging infrastructure change plan](STAGING_CHANGE_PLAN.md).

## Canonical build preflight

D062 makes Linux the only production build and publication host. macOS output
is local preview evidence and cannot be promoted. Before any staging or
production upload, check out the intended release commit on clean `main`, build
the scientific releases there, and run:

```bash
just production-release-preflight \
  data/releases/<dataset>/<release-id> [more-release-paths...]
```

The command validates complete schema-v1 graphs and requires immutable IDs,
resolved source releases, Linux build provenance, and an exact builder-commit
match. Passing it does not authorize an upload. The local dataset-release
publisher in `tools/s3_publish.py` calls the same checks on its private snapshot
before opening a remote transaction; see [commands and limits](../../publishing/README.md#local-s3-release-command).

## Confirmed candidate location

- AWS Region: `us-east-1`
- private bucket: `ibl-brain-wide-map-private`
- existing scientific prefix: `aggregates/atlas/`
- staging root: `aggregates/atlas/ephys-atlas-web-v2/staging/`
- production root: `aggregates/atlas/ephys-atlas-web-v2/production/`
- production viewer domain (D072): `ephys-atlas.iblcore.org`
- production delivery: one CloudFront distribution serving the compiled Vite
  viewer and same-origin public data from the private production namespace
- publication: operator-invoked local repository command; no always-on
  publishing server and no Cloudflare Pages deployment initially

## Read-only production audit (2026-09-08)

The renewed `ibl-atlas` session identifies
`arn:aws:iam::842577843587:user/iblmember`. A read-only audit confirmed this
production state:

- CloudFront distribution `ET6VJW8JWAGVR` is deployed at
  `d2is8oq6heobqy.cloudfront.net`, with alias
  `ephys-atlas.iblcore.org`, HTTP-to-HTTPS redirect, TLS policy
  `TLSv1.2_2021`, HTTP/2 and HTTP/3, and the selected production origin path;
- the origin is the S3 REST endpoint and uses legacy OAI
  `E359S50BKNNGWZ`, not the OAC selected by D060 and this runbook;
- the bucket policy grants that OAI `s3:GetObject` only for production
  `site/*`, `atlas/*`, `datasets/*`, `catalog.json`, and an obsolete root
  `index.html`; it does not grant the staging root or private `_staging/*`;
- all four S3 Block Public Access settings are enabled and the bucket default
  encryption is SSE-S3 (`AES256`);
- both selected environment roots currently contain zero objects;
- the website and ACM-validation CNAMEs resolve, and the live endpoint presents
  HTTPS through CloudFront. `/`, `/app/`, and `/catalog.json` currently return
  `403` because no objects have been published and no route function is
  associated;
- the distribution has no ordered cache behaviors, response-headers policy, or
  function association. Its sole behavior disables compression and uses TTLs
  0/3600/86400 seconds; its default root object is `index.html`.

The audit directly proves `cloudfront:GetDistribution` for the production ID,
exact-prefix S3 listing, bucket-policy and public-access-block inspection. The
identity cannot enumerate distributions or inspect IAM policy attachments,
the OAI object, or the ACM certificate through AWS APIs. These read-only
denials do not imply that the corresponding resources are absent. No staging
distribution ID has been supplied, and no staging CloudFront principal is
present in the bucket policy, so isolated staging delivery is not currently
usable from the evidence available here.

The existing OAI keeps the bucket private and is sufficient for read-only S3
delivery, but it differs from the accepted OAC design. Treat an OAI-to-OAC
migration as a separately reviewed infrastructure change: create/attach the
OAC first, merge the distribution-ARN-scoped bucket grant, verify delivery,
and only then remove the OAI grant. Do not widen the current policy during the
migration.

On 2026-09-02, an authorized IAM user authenticated from the repository host
with temporary console-derived credentials. The following checks succeeded:

- authenticated `ListObjectsV2` below `aggregates/atlas/`;
- `HeadObject` on an existing object;
- a non-mutating `PutObject` authorization probe against an existing key with
  `If-None-Match: *`, which returned `412 PreconditionFailed` as expected;
- a second `HeadObject` confirming unchanged size, ETag, and modification time.

Anonymous listing returned `403 AccessDenied`. No object was created, replaced,
or deleted. The 2026-09-08 audit above supersedes the earlier uncertainty about
default encryption and production CloudFront behavior. Publisher write access
to the exact D059 environment roots has still not been exercised.

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
- `s3:GetObject` and `s3:PutObject` on objects below that root.

Do not add `s3:DeleteObject`, ACL, bucket-configuration, or wildcard `s3:*`
permissions unless a separately reviewed operation requires them. If the
implementation later adds multipart uploads, add its exact multipart actions at
that time. Current commands use single-object conditional PUT and reject
objects above 5 GB. The selected bucket default uses SSE-S3, so these commands
do not need KMS permissions.

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

D061 separates immutable dataset publication from cross-dataset public
discovery. Project membership, edition mappings, release presentation, and
defaults come from a repository-versioned curator configuration. An explicit
curator operation compiles that configuration against the published inventory,
rejects remapping any exposed `(project_id, edition_id)`, validates the whole
prospective graph, and promotes `catalog.json` last with a conditional write.
Failure retains the last-known-good catalog. Ordinary dataset publishing cannot
mutate edition or default metadata, and both the local S3 publisher and any
future hosted service must reuse the same compiler.

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
the public child paths within the selected deployment root, excluding private
`_staging/` and administrative state. The production distribution must not
expose the staging root or sibling canonical/source aggregates. A staging
distribution or equivalently isolated non-production boundary must be
provisioned before production. DNS may remain with its current provider; the
CloudFront custom-domain certificate belongs in ACM `us-east-1`.

## Deployment stop conditions

Before the first repository-managed upload, Q8 must record or confirm:

1. the exact new staging CloudFront distribution, origin path, OAC and
   root-scoped bucket policy, plus the observed production distribution and its
   separately reviewed intended changes;
2. the staging generated hostname plus the observed production DNS and ACM/TLS
   arrangement;
3. MIME, CORS, Range, cache, and opaque `.isvg.gz` metadata rules;
4. minimum local-publisher IAM policy and credential/profile handling;
5. the immutable-release promotion and curator-owned conditional
   catalog/alias update procedure, including immutable edition-history state;
6. the first exact artifact set authorized for staging.

Current local artifact inventory is useful build input, not a publishable first
set. The active development bundle contains four reviewed local scientific
releases, the production-intent projection pack, the D070 mesh and the AGEA
preview. The scientific releases were built at an older commit and lack the
current exact Linux/HEAD provenance; the volume ID is explicitly a candidate;
the projection pack likewise lacks current Linux/HEAD build evidence. Q2, Q5
and Q9 prevent treating those bytes as the paper release/default set, and there
is no tracked curator or site dependency configuration. Rebuild only the
explicitly authorized staging set on clean Linux `main`; never relabel these
local artifacts.

There is also a tooling stop condition for Q5 measurement: the current S3
release publisher applies the production preflight in both environments, and
that preflight rejects `candidate` IDs. A staging-only, scientifically labelled
benchmark path must be reviewed and implemented before the depth-four candidate
can be measured at the real origin. Do not evade this check by renaming the
existing candidate.

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
