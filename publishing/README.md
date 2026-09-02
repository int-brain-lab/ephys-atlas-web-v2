# IBL Ephys Atlas v2 publishing

Minimal capability-based publishing service and Python client. It publishes prepared dataset releases; it does not build or transform scientific data.

D060 keeps this HTTP service as an optional future multi-publisher path. The
initial production deployment uses no always-on publishing server: an
operator-invoked local repository command will apply the same validation and
immutable-publication rules directly to private S3 with temporary scoped AWS
credentials. That S3 command remains to be implemented.

## Properties

- public reads are static files under `STORAGE/public/`
- releases are immutable directories
- `latest` and other aliases live in the mutable dataset index
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

The browser/CDN should read `STORAGE/public/catalog.json`, dataset `index.json` files, and immutable release files directly. It need not call the publishing API.

Resume an interrupted upload using its upload ID:

```bash
uv run --project publishing --locked ephys-atlas-publish resume \
  --url https://publish.example.org UPLOAD_ID data/releases/... --alias latest
```
