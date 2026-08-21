# IBL Ephys Atlas v2 publishing

Minimal capability-based publishing service and Python client. It publishes prepared dataset releases; it does not build or transform scientific data.

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
PYTHONPATH=publishing/src pytest publishing/tests -q
PYTHONPATH=publishing/src python -m ibl_ephys_atlas_publish credential-create \
  --credentials /srv/ephys-publish/credentials.json --label maintainer --can-create-datasets
```

Run the service behind nginx/TLS:

```bash
export PYTHONPATH=/opt/ibl-ephys-atlas-web-v2/publishing/src
python -m ibl_ephys_atlas_publish serve \
  --storage /srv/ephys-publish/storage \
  --credentials /srv/ephys-publish/credentials.json \
  --host 127.0.0.1 --port 8080 \
  --validator-command 'ephys-atlas-data validate {release_dir}'
```

For production, the example systemd unit uses one Gunicorn worker with threads behind nginx; the built-in `serve` command is for smoke testing/simple internal deployment.

Publish a directory already produced by the data builder:

```bash
export IBL_PUBLISH_TOKEN='iblpub_...'
ephys-atlas-publish dataset-create --url https://publish.example.org ephys_atlas_channels
ephys-atlas-publish publish --url https://publish.example.org \
  ephys_atlas_channels 2026-08-19 data/releases/ephys_atlas_channels/2026-08-19 \
  --alias latest
```

The browser/CDN should read `STORAGE/public/catalog.json`, dataset `index.json` files, and immutable release files directly. It need not call the publishing API.

Resume an interrupted upload using its upload ID:

```bash
ephys-atlas-publish resume --url https://publish.example.org UPLOAD_ID data/releases/... --alias latest
```
