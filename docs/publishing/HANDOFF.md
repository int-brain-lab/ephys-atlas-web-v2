# Publishing status and handoff

Status: current supporting summary. Launch priority and deployment decisions
remain in `docs/IMPLEMENTATION_PLAN.md` and `docs/OPEN_QUESTIONS.md`.

## Implemented model

The stdlib WSGI service and Python client publish already-built releases; they
do not transform scientific data. The implementation provides:

- independently revocable capability credentials stored as salted PBKDF2
  hashes, with an explicit dataset-creation capability;
- private resumable staging with contiguous offsets;
- declared artifact byte-size and SHA-256 verification;
- an external schema-validator hook that fails closed and has a timeout;
- immutable release publication by same-filesystem atomic rename;
- mutable aliases and browser-compatible public catalog/index generation kept
  outside immutable release directories;
- dataset archive rather than routine destructive deletion;
- independent default request limits of 32 MiB for JSON metadata and 16 MiB for
  binary chunks, configurable in CLI, WSGI, systemd, and nginx;
- a process-wide filesystem lock shared by WSGI mutations and stale-staging
  maintenance, making mutation safety independent of thread or worker count.

Public reads are static files under `STORAGE/public/` and should be served by
nginx or object storage/CDN without authentication. The publishing API handles
mutations only. See `docs/publishing/API.md` and `publishing/README.md`.

## Deployment contract

- Terminate TLS at nginx or equivalent; never send bearer credentials over
  plaintext networks.
- Keep credentials, private staging, and service configuration readable only
  by the service account. Do not commit tokens or deployment secrets.
- Configure the validator as
  `uv run --project /opt/ibl-ephys-atlas-web-v2/builder --locked --no-sync
  ephys-atlas-data validate {release_dir}` so it uses the same locked builder
  environment as local validation and CI. Prepare the builder and publishing
  environments with explicit locked `uv sync` commands before starting the
  protected service; runtime commands must not resolve or install packages.
- Keep staging and public roots on the same filesystem when using atomic rename.
- Back up public releases, catalog/index/alias control state, credential
  registry, and operational audit data if the service is deployed.
- Serve immutable releases with long-lived cache headers and mutable
  catalog/index/alias objects with revalidation; verify the exact policy from
  the selected production origin.
- Serve projection-pack `.isvg.gz` resources as opaque stored bytes without
  HTTP `Content-Encoding`. The browser verifies the encoded byte count and
  SHA-256 before explicitly decompressing them; transparent origin/CDN
  decompression invalidates that contract. Verify this behavior from the
  deployed origin rather than relying only on filename conventions.

An object-storage backend can later replace filesystem rename with a unique
staging prefix plus conditional publication of the small mutable index object.
That is a deployment adapter change, not a scientific contract change.

## Remaining decisions

Q8 still requires the public domain, storage/CDN arrangement, cache/CORS policy,
and publishing destination. Q9 still requires the frozen paper aliases and
release set. Remote publishing may be explicitly waived for launch if static
release deployment is operationally sufficient, as allowed by the launch spec.

Possible follow-ups that are not current launch requirements include delegated
multi-credential ownership for one dataset, a database/object-store control
plane if single-host filesystem deployment becomes insufficient, and a legacy
v1 import adapter that builds normal immutable v2 releases.

Run `just test-publishing` for the focused suite and `just check` for the
repository gate.
