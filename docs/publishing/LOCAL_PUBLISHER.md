# Local publisher operations

Status: runbook; offline-tested implementation. Repository publication commands
have made no remote upload or site deployment. The separate 2026-09-08 audit
observed existing production DNS/CloudFront setup; Q8 still gates changes and
remote publisher use. Q2/Q5/Q9/Q19 govern scientific content and defaults.

Run these commands from the repository root with the locked builder environment.
All publication commands default to offline validation/planning. `--apply`
requires an explicit temporary-credential profile and the exact environment
prefix via `--confirm-root`. They create no infrastructure and delete nothing.
Do not substitute `aws s3 sync` for these transactions.

## 1. Publish immutable dataset releases

Use `tools.s3_publish` as documented in [the publishing README](../../publishing/README.md#local-s3-release-command).
It preflights a private snapshot on clean Linux `main`, stages/validates encoded
objects, creates immutable dependencies before the manifest, writes the
completion record, and conditionally updates the administrative dataset index.
It never changes the public catalog, project editions or scientific defaults.

## 2. Publish validated projection and optional mesh packs

```bash
uv run --project builder --extra test --locked python -m tools.s3_assets \
  projection <pack-directory> --environment staging
uv run --project builder --extra test --locked python -m tools.s3_assets \
  mesh <pack-directory> --environment staging
```

The complete existing schema-v1 validators are reused. Projection packs require
current Linux builder environment and exact HEAD provenance; mesh packs require
production purpose, exact HEAD and Linux environment in the hash-bound report.
Future production projection CLI builds now record the environment and bind it
into a new pack ID; the existing local packs remain unchanged. Old local packs
lacking this evidence fail closed. Do not hand-edit their
manifests or relabel them: prepare a new properly identified build through the
approved pack builders and geometry/source gates. This implementation does not
regenerate anatomy or claim that the existing local projection pack is ready.

Public paths are derived from validated pack IDs:

```text
atlas/projections/<pack-id>/manifest.json
atlas/meshes/<pack-id>/manifest.json
```

Files retain their exact encoded bytes and relative graph. Private reservations
prevent different graphs from reusing one pack ID. Dependencies are remotely
verified before the manifest; `_publication.json` completes the pack. No
mutable application URL changes here. All gzip payloads remain opaque with no
HTTP Content-Encoding.

## 3. Compile and promote the curator catalog

Commit a curator configuration selecting the exact projects, editions, release
labels and defaults. Its shape matches the public catalog except that release
`manifest` descriptors are omitted; the shared compiler derives these from
validated releases. No real configuration is supplied by this task because Q9
remains unresolved. Config files must be tracked on clean `main`.

```bash
uv run --project builder --extra test --locked python -m tools.s3_catalog \
  <tracked-curator-config.json> --environment staging \
  --release <release-directory> --release <another-release-directory>
```

Provide every release referenced by the configuration. Offline mode validates
local graphs and catalog structure, but explicitly does not claim to have
checked remote publication or historical edition mappings. Apply mode verifies
published completion records, indexes and every declared remote object's
checksum/size/serving metadata before invoking the same compiler as the
filesystem publishing service.

Each successful S3 promotion exposes a unique schema-v1 `publication_id`.
Its immutable private `_staging/catalog-history/<publication-id>.json` records
the complete cumulative edition history and catalog hash. This record is
created first; one conditional write replaces `catalog.json` last. Losing
writers leave only unreferenced private records. No catalog update happens if
validation or the conditional write fails. A retry rereads the winner's
catalog/history and recompiles; never force an overwrite.

Restoring older catalog contents still gets a fresh publication ID, preventing
an A→B→A ETag race. Omitting an edition never frees its ID for remapping. Keep
all referenced history records indefinitely. An existing catalog without its
matching generation/history fails closed and needs a separately reviewed
migration; there is no silent history reset or automatic garbage collection.

## 4. Build the site for the deployed dependency set

Commit a site configuration containing `catalog`, `projection` and optional
`mesh` objects. Each has exact `path`, `bytes`, and lowercase `sha256` fields.
Paths are relative to the deployment root: `catalog.json` and the public pack
manifest paths above. Use actual published manifest/catalog bytes, including
the catalog's generation. No placeholder hashes can satisfy remote checks.

```bash
uv run --project builder --extra test --locked python -m tools.site_build \
  <tracked-site-config.json> <new-build-directory>
uv run --project builder --extra test --locked python -m tools.s3_assets \
  site <new-build-directory> --environment staging
```

The build wrapper requires clean Linux `main` and Node 22. It clears inherited
preview defaults and disables `.env` loading, dev plugins and Vite's public
directory copying. Only the compiled application and explicit brand/favicon
files are included. Scientific data and packs remain separate.

The receipt binds commit, Linux/Node environment, configuration and every file
hash. Assets and HTML refer to `/site/builds/<build-id>/...`; generated HTML
references must resolve inside that build. Publication verifies the pinned
remote catalog/pack manifest dependencies, privately stages the site, then
creates the complete immutable build before conditionally replacing
`site/index.html`. A unique non-rendered publication comment prevents ETag reuse
on rollback. Do not delete old build directories: existing sessions may still
load their chunks. A rollback is an explicitly approved publication operation,
not an unguarded copy; ordinary preflight still applies.

## Apply and infrastructure boundary

Only after the exact artifact operation is authorized, append:

```text
--apply --profile ibl-atlas --confirm-root aggregates/atlas/ephys-atlas-web-v2/staging/
```

Production uses the exact production root and separate authorization. Temporary
disk space must accommodate the local snapshots; S3 retains both staging and
public objects. Object-level resume is implemented; objects above 5 GB fail
before network access because multipart is not implemented.

[AWS console setup](AWS_CONSOLE_SETUP.md) defines the remaining infrastructure
work. `tools/deployment/site-router.js` is the tested CloudFront viewer-request
function: `/`, `/app`, and `/app/` become `/site/index.html`; that entry keeps
the landing static at `/` and bootstraps the viewer at `/app/`. URL queries and
data errors are preserved. It is not deployed. The incoming public routes and
direct site entry must not cache stale HTML; immutable build/pack/release
behaviors can cache for one year. Production routing does not need legacy
`/assets` or `/brand` rewrites because the build embeds its immutable base.

Separate permissions by operation: releases write `datasets/*`; pack publication
writes `atlas/projections/*` or `atlas/meshes/*`; sites write `site/*`; curator
promotion alone writes `catalog.json`. All use private `_staging/*` transaction
objects and scoped reads for their dependencies. CloudFront may read only
public paths, never `_staging/*`. No delete, bucket administration or DNS
permissions belong to these publishing commands.

## Verification

The deterministic suites cover create-only identity, metadata and integrity,
interruption/resume, catalog omission/remapping, stale writers after rollback,
site dependency failure and last-known-good entry preservation. A browser test
builds and loads the production Vite mode against the canonical test-only
release server without copying synthetic data into the build. `just check`
is the full local gate. Real-origin IAM, MIME/Range/cache and browser evidence
remain unclaimed until the first authorized staging deployment.
