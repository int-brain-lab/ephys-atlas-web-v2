# Publishing API v0

All mutation endpoints use `Authorization: Bearer <publisher-token>`. Public catalog and release reads are intentionally not API endpoints; nginx/object storage/CDN serves them directly.

## Datasets

- `GET /api/datasets` — service-side catalog view, public in the skeleton.
- `GET /api/datasets/{dataset}` — dataset index.
- `POST /api/datasets` — create dataset; requires a credential with dataset-creation capability.
- `POST /api/datasets/{dataset}/archive` — remove dataset from active catalog without deleting immutable releases.
- `PUT /api/datasets/{dataset}/aliases/{alias}` with `{"release_id":"..."}` — move an alias.

## Release upload

1. `POST /api/datasets/{dataset}/uploads` with a release ID and artifact descriptors `{path,size,sha256}`.
2. `GET /api/uploads/{upload}` returns current byte offsets.
3. `PUT /api/uploads/{upload}/files/{path}` with `Upload-Offset` appends the next chunk. Nonmatching offsets return `409` plus the expected offset.
4. `POST /api/uploads/{upload}/publish` with optional aliases.

Publication verifies every artifact, runs the configured validator, writes `_publication.json`, then performs a same-filesystem atomic rename of the staged release directory into `public/datasets/<dataset>/releases/<release>`. Only after that rename the dataset indexes/aliases updated.

## Static layout

```text
public/
  catalog.json
  datasets/<dataset>/
    index.json
    releases/<release>/
      manifest.json
      ... dataset artifacts ...
      _publication.json
```

`_publication.json` is publishing metadata only; the scientific contract remains
`manifest.json` and schema v0.1 under `schema/v0.1/`.
