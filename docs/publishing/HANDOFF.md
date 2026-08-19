# Publishing handoff

## v1 findings

V1 is a compact Flask/file-backed bucket API. Reads are public; bucket creation uses one global bearer key; each bucket stores a bearer token in `_bucket.json`; mutation/deletion uses that bucket token. `FeatureUploader` stores the global key and bucket tokens in `~/.ibl/custom_features.json` and combines scientific transformation with remote upload.

Security/operational weaknesses worth fixing rather than carrying forward:

- one universal global secret gates all bucket creation and is difficult to rotate selectively;
- bucket bearer tokens are stored in cleartext server metadata and client JSON;
- token generation uses `random.getrandbits()`/UUID rather than the `secrets` module;
- token parsing/comparison is brittle, token normalization lowercases secrets, and comparison is not constant-time;
- no explicit revocation list, publisher identity label, audit log, or least-privilege creation capability;
- no staging/commit transaction: feature mutation changes the public file directly;
- volume bytes are base64-embedded into JSON, making large/resumable uploads inefficient;
- read requests mutate `last_access_date`, so the read path is not truly static/cacheable;
- backend, storage, auth, tests and dev TLS live in one Flask file; production lifecycle assumptions are implicit;
- deletion is destructive and releases are mutable, which is unsuitable for cited scientific snapshots.

## v2 design

The implemented skeleton treats scientific releases as opaque prepared directories:

```text
builder -> validate/build release -> publishing client -> private staging
                                             |              |
                                             |       size/SHA + schema validator
                                             v              v
                                      publishing API -> atomic rename
                                                        -> public static tree
```

Dataset releases are immutable. Dataset indexes and aliases are mutable control metadata. `latest` may move; paper-facing URLs should use an immutable release ID.

Authentication remains capability-based. Multiple publisher credentials are issued independently. Server storage contains salted PBKDF2 hashes, not bearer tokens. Credentials can be revoked independently. A boolean capability controls dataset creation; existing dataset mutation is limited to the credential that created it. This deliberately avoids OAuth/accounts/identity management.

## Implemented pieces

`publishing/` contains a stdlib-only WSGI service, filesystem publication store, credential registry, Python client, CLI, tests, nginx/systemd examples, and API documentation.

The upload protocol supports contiguous chunk append and resume from reported offsets. Every artifact declares path, byte size and SHA-256 before upload. Publication fails closed on incomplete/corrupt artifacts. A configured external validator is run before publication.

The data-schema branch currently provides `ephys-atlas-data validate <release_dir>`. Deployment should configure:

```text
--validator-command 'ephys-atlas-data validate {release_dir}'
```

Thus publishing does not invent or duplicate the scientific schema.

## Security assumptions

- TLS terminates at nginx (or equivalent); bearer tokens must never travel over plaintext networks.
- credentials file and private state are readable only by the service account; generated credential files are mode `0600` on POSIX.
- public releases contain no secrets.
- publisher tokens should normally be supplied from an environment variable or secret manager, not committed to source control.
- single-host filesystem mode assumes one mutation worker. For multi-process/object-storage deployment, replace the in-process lock and atomic rename with a DB/object-store conditional commit mechanism.
- rate limiting, request-size limits, logging and IP controls belong at the reverse proxy.

## Deployment assumptions

For the four-week launch, one project-owned Linux server is sufficient:

- nginx serves `/data/` from `STORAGE/public/` with long cache headers for immutable `/releases/` paths and short/no-cache headers for catalog/index aliases;
- nginx proxies `/api/` to the WSGI publishing process on localhost;
- systemd runs Gunicorn with one worker (threads are safe); keep one mutation process because filesystem locking is process-local;
- staging/public reside on the same filesystem so final `rename(2)` is atomic;
- volumes upload in chunks rather than one JSON request;
- nightly backup should cover public releases, dataset indexes, credential registry, and audit log. Staging can be excluded or short-retention.

Object storage/CDN is a natural next backend: upload to a unique staging prefix, validate, copy/compose to an immutable release prefix, then atomically/conditionally replace only the small catalog/index object. The browser architecture does not change.

## Archive/deletion policy

Default operation is archive, not delete. Archive removes a dataset from the active catalog but leaves releases addressable for provenance. Physical deletion should be an explicit operator procedure after retention/backups, not a routine publisher API endpoint.

## Legacy migration

Low priority. A future adapter can fetch each v1 bucket feature and build a valid v2 release through the normal data builder. V2 should not preserve mutable bucket semantics or base64-in-JSON volume transport.

## Unresolved integration decisions

- Integration should merge/rebase current `work/data-schema` before wiring the validator executable into production packaging; publishing intentionally references its CLI contract rather than copying code.
- Decide the canonical public URL layout/domain and whether nginx or S3-compatible object storage owns `catalog.json` at launch.
- Decide whether a second credential may be delegated access to an existing dataset. The launch skeleton uses single-creator ownership; a small per-dataset allow-list is the next extension if collaboration requires it.
- Decide operational release-ID convention (date, semantic vintage, or source snapshot ID). Publishing validates syntax only.
