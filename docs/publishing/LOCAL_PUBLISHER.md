# Local publisher operations

Direct first-deployment update (D074, 2026-09-08): a separate staging identity
and distribution are optional. The active path uses the existing atlas origin;
see [the reduced access request](AWS_DEPLOYMENT_ACCESS_REQUEST.md). References
below to required staging setup describe the earlier isolated-staging path.


Status: runbook; direct initial deployment authorized by D074. S3 access and
CloudFront router publication/invalidation are verified. The v2 distribution's
routing/cache update is deployed. The five initial scientific releases, both
anatomy packs and initial catalog were published on 2026-09-08. Their exact
dependencies and approved default are pinned in
[`initial-site.json`](../../data/deployment/initial-site.json). The site is live;
Chromium/Firefox live workflows and delivery fixes have been verified; see
[initial deployment evidence](INITIAL_DEPLOYMENT_20260908.md). D075 resolves Q5, and the fresh production volume release is catalogued. The
separate benchmark remains outside ordinary release discovery. Final paper/scientific
review questions retain their stated scope.

Run these commands from the repository root with the locked builder environment.
All publication commands default to offline validation/planning. For large
releases, add `--transport sdk` and run the builder environment with
`--extra scientific --extra test --locked`. The SDK reuses authenticated
connections with up to 16 independent object operations per phase; CLI remains
the default serial transport. Both implement the same checksum/conditional-write
protocol. The SDK session and S3 client both use `us-east-1`, including nested
login credential refresh; a profile-level region is not required.
Reservations, phase boundaries, entry manifests, completion records
and mutable index/catalog/site commits remain ordered. Failed parallel phases
finish in-flight work and stop before exposing the next entry/commit. `--apply`
requires an explicit temporary-credential profile and the exact environment
prefix via `--confirm-root`. They create no infrastructure and delete nothing.
Do not substitute `aws s3 sync` for these transactions.

## 1. Publish immutable dataset releases

Use `tools.s3_publish` as documented in [the publishing README](../../publishing/README.md#local-s3-release-command).
It preflights a private snapshot on clean Linux `main`, stages/validates encoded
objects, creates immutable dependencies before the manifest, writes the
completion record, and conditionally updates the administrative dataset index.
It never changes the public catalog, project editions or scientific defaults.

For a Q5 transport candidate, use the explicit non-catalogued staging mode:

```bash
uv run --project builder --extra test --locked python -m tools.s3_publish \
  data/releases/ephys_atlas_volumes/<candidate-release-id> \
  --environment staging --staging-benchmark
```

This mode retains the candidate ID, applies the clean Linux `main`, exact
HEAD/environment, resolved-source, schema and complete-graph checks, and rejects
production, aliases, dataset-index updates and curator completion. Its public
release objects are addressable only by an exact staging URL and carry a
distinct `_benchmark_publication.json` record. Fill the exact candidate and
transaction placeholders in the staging benchmark IAM template from the
offline plan before an authorized `--apply` run.

For the approved direct-origin Q5 path, use `--direct-benchmark` with
`--environment production`. This is restricted to candidate-ID
`ephys_atlas_volumes` releases and writes only
`datasets/ephys_atlas_volumes/benchmarks/<candidate-id>/`, plus private
transaction/reservation objects. It cannot write ordinary release keys,
dataset indexes, aliases or catalog entries. Its benchmark completion marker
is not accepted by curator promotion. The existing `--staging-benchmark`
remains staging-only; neither mode relabels a candidate as production data.

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
validated releases. The D074 initial deployment selection is tracked in
[`initial-curator.json`](../../data/deployment/initial-curator.json). Config
files must be tracked on clean `main`.

```bash
uv run --project builder --extra test --locked python -m tools.s3_catalog \
  <tracked-curator-config.json> --environment staging \
  --release <release-directory> --release <another-release-directory>
```

Provide every release referenced by the configuration. Catalog compilation may
reuse historical, canonical Linux-built immutable releases; their builder commit
need not equal the current curator commit. The operator still uses clean Linux
`main`. Apply must match each historical graph against the remote ordinary
publication record, index and every resource checksum/serving descriptor before
writing a catalog. This exception is catalog-only: publishing new release bytes
still requires exact current-HEAD/environment preflight. Offline mode validates
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

Commit a site configuration containing `catalog`, `projection`, `atlas_regions`
and optional `mesh` objects. Each has exact `path`, `bytes`, and lowercase `sha256` fields.
Paths are relative to the deployment root: `catalog.json` and the public pack
manifest paths above. Use actual published manifest/catalog bytes, including
the catalog's generation. No placeholder hashes can satisfy remote checks.

`atlas_regions` instead pins the committed local file
`web/public/atlas/allen-ccf-2017/regions.json`, with descriptor path
`atlas/allen-ccf-2017/regions.json`. The wrapper copies those exact bytes into
the immutable site build and supplies its build-specific URL, size and SHA-256
to the viewer. The browser verifies it before parsing. This bundled asset is
not an additional remote dependency or a mutable root-level atlas file.

```bash
uv run --project builder --extra test --locked python -m tools.site_build \
  <tracked-site-config.json> <new-build-directory>
uv run --project builder --extra test --locked python -m tools.s3_assets \
  site <new-build-directory> --environment staging
```

The build wrapper requires clean Linux `main` and Node 22. It clears inherited
preview defaults and disables `.env` loading, dev plugins and Vite's public
directory copying. Only the compiled application, explicit brand/favicon files
and pinned atlas region metadata are included. Numeric datasets and packs remain separate.

To pin the initial viewer selection, add this optional `default_view` object to
the tracked site configuration, alongside the dependency descriptors:

```json
{
  "default_view": {
    "project_id": "ephys-atlas",
    "dataset_id": "ephys_atlas_channels",
    "release_id": "2026_W32-ibl-review-20260908-v1",
    "feature_id": "rms_ap.denoised",
    "parcellation_id": "allen",
    "curator_config": "data/deployment/initial-curator.json"
  }
}
```

The wrapper accepts only this explicit field set. It verifies that the tracked
curator configuration selects the named default project, dataset, release and
edition, then supplies only those four `VITE_DEFAULT_*` values to Vite. The
full configuration is part of the receipt and build identity. A later default
change requires a new coherent site build and site publication; it does not
rebuild or relabel a scientific release. The catalog/release build audit still
verifies that the selected feature exists.

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
data errors are preserved. The function is published and the v2 distribution
update is deployed and live routing has been verified. The incoming public routes and
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
is the full local gate. Real-origin IAM, MIME/Range/cache, private-boundary and browser evidence
is recorded in [initial deployment evidence](INITIAL_DEPLOYMENT_20260908.md).
