# Publishing status and handoff

Status: runbook for publishing deployment and operations. Launch priority and
deployment decisions remain in `docs/IMPLEMENTATION_PLAN.md` and
`docs/OPEN_QUESTIONS.md`.

## Implemented optional service

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

Public reads are static files under `STORAGE/public/` and can be served by
nginx or object storage/CDN without authentication. The publishing API handles
mutations only. See `docs/publishing/API.md` and `publishing/README.md`.

D060 does not deploy this service for the initial release. It selects an
operator-invoked local repository publisher using temporary, least-privilege
AWS credentials. The local path must preserve the implemented service's
private resumable staging, complete validation, immutable-key protection, and
catalog-last publication semantics while writing the D059 S3 roots directly.
CloudFront serves both the compiled Vite viewer and same-origin public data;
there is no always-on publishing backend or Cloudflare Pages dependency.

The candidate private S3 access evidence, temporary CLI authentication, safe
preflight commands, and deployment stop conditions are recorded in
[`S3_DEPLOYMENT.md`](S3_DEPLOYMENT.md). That runbook does not resolve Q8 or
authorize a specific release upload.

## Hosted-service contract if enabled later

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

## Remaining deployment work

D059 selects exact staging and production roots in the authenticated private
bucket and plans `ephys-atlas.iblcore.org` as the initial viewer domain. D060
selects the local publisher plus a CloudFront/OAC boundary for both the
S3-hosted Vite application and data. Q8 still requires implementation of that
publisher, exact staging/production distributions and origin restrictions,
staging hostname, DNS/ACM, cache/CORS/MIME/Range policy, minimum IAM policy,
and first staging artifact authorization. Q9 still requires the frozen paper
aliases and release set.

Possible follow-ups that are not current launch requirements include delegated
multi-credential ownership for one dataset, a database/object-store control
plane if single-host filesystem deployment becomes insufficient, and a legacy
v1 import adapter that builds normal immutable v2 releases.

Run `just test-publishing` for the focused suite and `just check` for the
repository gate.
