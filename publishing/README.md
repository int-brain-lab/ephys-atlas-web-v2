# IBL Ephys Atlas v2 publishing

Minimal capability-based publishing service and Python client. It publishes prepared dataset releases; it does not build or transform scientific data.

D060 keeps this HTTP service as an optional future multi-publisher path. The
initial production deployment uses no always-on publishing server: an
operator-invoked local repository command will apply the same validation and
immutable-publication rules directly to private S3 with temporary scoped AWS
credentials. The first S3 dataset-release command is implemented with offline
tests. Curator catalog/edition-history promotion, pack/site publication and an
isolated production site build are also implemented; see
[Local publisher operations](../docs/publishing/LOCAL_PUBLISHER.md).
Remote infrastructure and integration evidence remain next steps.

## Local S3 release command

Run from the repository root with the builder's locked environment:

```bash
uv run --project builder --extra test --locked python -m tools.s3_publish \
  data/releases/<dataset>/<release-id> --environment staging
```

This default mode is fully offline. It applies the canonical Linux/clean-main/
exact-build-commit preflight to a temporary snapshot, rejects undeclared files,
and prints an inventory, hashes, destination and transaction ID. It does not
promote the existing local-preview/candidate releases or select public defaults.

Only after Q8 infrastructure and the exact upload are authorized:

```bash
uv run --project builder --extra test --locked python -m tools.s3_publish \
  data/releases/<dataset>/<release-id> --environment staging \
  --apply --profile ibl-atlas \
  --confirm-root aggregates/atlas/ephys-atlas-web-v2/staging/
```

Optional `--alias latest` changes the administrative dataset alias, never the
curator catalog. Re-run the same command after an interruption or index-write
conflict. Complete objects are reused only after checksum, size and serving
metadata verification; a partial object restarts. Objects above 5 GB fail
before network access (multipart is not yet implemented). Budget temporary
disk space for one full release copy and S3 space for private and public copies.

Private `_staging/` reservations and objects are retained for recovery; no
delete/cleanup command is provided. CloudFront must not be allowed to read
`_staging/`. A different inventory cannot reuse a reserved release identity.
The command creates no bucket, distribution, DNS record, or public catalog.
See [AWS console setup](../docs/publishing/AWS_CONSOLE_SETUP.md) before applying.

## Properties

- public reads are static files under `STORAGE/public/`
- releases are immutable directories
- `latest` and other aliases live in the mutable dataset index
- public project membership, editions, release presentation, and defaults are
  emitted only by an explicit curator-owned catalog promotion
- uploads are staged privately and become public only after complete size/SHA-256 checks and validation
- upload is chunked and resumable using server-reported offsets
- publisher tokens are independently revocable and only salted PBKDF2 hashes are stored server-side
- dataset creation can be restricted to credentials carrying `can_create_datasets`
- a dataset is owned by the credential that created it; no user/account system is required
- JSON metadata requests are bounded at 32 MiB by default, enough for the
  supported 100,000-artifact inventory with representative volume paths;
  binary upload chunks have a separate 16 MiB default cap

The built-in server accepts `--max-json-bytes` and `--max-chunk-bytes`.
Gunicorn/WSGI deployments configure the same limits with
`IBL_PUBLISH_MAX_JSON_BYTES` and `IBL_PUBLISH_MAX_CHUNK_BYTES`. Keep the reverse
proxy request limit at least as large as the greater application limit.

## Local smoke test

```bash
uv run --project publishing --extra test --locked \
  python -m pytest publishing/tests -q
uv run --project publishing --locked ephys-atlas-publish credential-create \
  --credentials /srv/ephys-publish/credentials.json --label maintainer --can-create-datasets
```

Run the service behind nginx/TLS:

```bash
uv sync --project /opt/ibl-ephys-atlas-web-v2/builder --python 3.12 --locked
uv sync --project /opt/ibl-ephys-atlas-web-v2/publishing --python 3.12 \
  --extra server --locked
uv run --project /opt/ibl-ephys-atlas-web-v2/publishing --locked \
  ephys-atlas-publish serve \
  --storage /srv/ephys-publish/storage \
  --credentials /srv/ephys-publish/credentials.json \
  --host 127.0.0.1 --port 8080 \
  --validator-command 'uv run --project /opt/ibl-ephys-atlas-web-v2/builder --locked --no-sync ephys-atlas-data validate {release_dir}'
```

The two explicit syncs prepare immutable deployment environments before the
service account starts. The example systemd unit uses `--no-sync` at runtime,
so its protected service process neither resolves dependencies nor writes into
the checkout.

The example systemd unit conservatively uses one Gunicorn worker with threads
behind nginx. Filesystem mutations are also serialized across WSGI processes by
a process-wide file lock, so deployments may increase worker count after
measuring their workload; public static reads remain outside the WSGI service.
The built-in `serve` command is for smoke testing/simple internal deployment.

Publish a directory already produced by the data builder:

```bash
export IBL_PUBLISH_TOKEN='iblpub_...'
uv run --project publishing --locked ephys-atlas-publish dataset-create \
  --url https://publish.example.org ephys_atlas_channels
uv run --project publishing --locked ephys-atlas-publish publish \
  --url https://publish.example.org \
  ephys_atlas_channels 2026-08-19 data/releases/ephys_atlas_channels/2026-08-19 \
  --alias latest
```

Publishing a release makes immutable bytes available but does not add them to
public discovery. A curator must compile and promote a complete catalog before
the browser/CDN can read `STORAGE/public/catalog.json`; no placeholder catalog
is emitted before the first promotion. Dataset `index.json` files and immutable
release files remain directly readable without calling the publishing API.

Resume an interrupted upload using its upload ID:

```bash
uv run --project publishing --locked ephys-atlas-publish resume \
  --url https://publish.example.org UPLOAD_ID data/releases/... --alias latest
```
