# Local development bundle

Status: active implementation and recovery plan. The descriptor/verifier
foundation is implemented; the complete corpus remains blocked on two missing
pinned input sets recorded below.

This plan defines how a fresh checkout will obtain the complete browser-ready
development corpus without creating a second scientific data format or a
developer-only repackaging. It does not authorize remote publication and does
not promote any validated-real-local candidate to production maturity.

## Outcome

The ordinary setup path should become:

```bash
just bootstrap
just data
just dev
```

- `just bootstrap` installs locked Python, Node, and browser dependencies;
- `just data` currently verifies the pinned local artifacts and reports the
  unresolved corpus entries; after Q8 it also obtains missing remote bytes;
- `just dev` serves every verified descriptor entry through the local Vite
  origin and never falls back for an unavailable dataset or pack.

`just dev` is the only public viewer recipe. The historical channel-only,
channel-plus-mesh, and `dev-local-full` recipes should be removed once the
bundle-driven command is implemented. Focused release acceptance remains in
the dedicated test and validation recipes rather than separate interactive
server commands.

## Byte-identity contract

The bundle contains the same immutable schema-v1 release directories,
projection pack, and mesh pack that a deployed browser can read. Downloading
for local development changes only their storage location and serving origin.
It must not rewrite manifests, resources, codecs, scientific metadata, or
hashes.

Environment-specific catalogs and aliases remain outside immutable artifacts.
The local Vite server may assemble a local catalog with local URLs, while a
staging or production catalog uses its own origin and approved defaults. HTTP
headers also belong to the serving environment. These differences do not
permit different release bytes.

Only browser-ready derived artifacts belong in this distribution path. Private
source Parquet, NPZ, annotation, LUT, and donor build inputs are not uploaded as
part of the development bundle.

## Initial bundle

The first committed bootstrap descriptor pins every currently recoverable
validated artifact without relabelling or substituting missing evidence:

| Role | Immutable identity | Current maturity |
| --- | --- | --- |
| Channels | `2026_W32-d050-peak-val-raw-v3` | deterministic technical revision of the validated-real-local development release; not the Q2 paper selection |
| Clusters | `sha256-9b5e55215b306f26-d050-d048-v2` | deterministic technical revision of the validated-real-local reviewed release; not published |
| Brain-Wide Map | unavailable pending recovery of the six exact pinned Parquets | required for the complete bundle; audit derivatives and older releases are not substitutes |
| Volume | `2026_W26-candidate-depth4-d050-linear-full-v2` | deterministic technical revision of the validated-real-local candidate; not the Q5 production transport |
| Projection pack | active schema-v1 `atlas-projection-pack-v1` | committed production-intent browser artifact; origin verification remains |
| 3-D mesh pack | unavailable pending recovery of the exact D042 donor | optional; a different or regenerated mesh is forbidden |

This is a development bundle identity, not a mutable `latest` alias and not a
claim about the eventual paper-facing production release set. Future bundles
receive new immutable bundle IDs; an existing descriptor is never silently
retargeted. The current `data/development-bundle-v1.json` is explicitly a
bootstrap descriptor, not the complete bundle: it validates 8,007 files and
526,673,799 bytes across the three scientific releases and projection pack
while recording both omissions.

## Bundle descriptor

Add a small committed machine-readable descriptor under `data/` or `schema/`
after choosing its exact contract. It must contain enough information to
locate and verify every bundle root without duplicating the release manifests'
complete transitive file graphs. At minimum it records:

- descriptor schema version and immutable bundle ID;
- artifact role, dataset/pack identity, and maturity label;
- destination relative to the repository's ignored data/artifact roots;
- root manifest media type, served-byte size, and SHA-256;
- source base URL or an explicit unresolved-origin state;
- whether an entry is launch-critical or optional for the bundle;
- descriptor generation/version provenance.

Repository-relative destinations must be explicit and bounded. The consumer
must reject absolute paths, traversal, duplicate destinations, duplicate
scientific identities, and unsupported descriptor versions.

## Implementation phases

### 1. Descriptor and local verification

1. Define the smallest descriptor schema and commit the initial pinned bundle.
2. Implement a Python verifier through the locked builder environment.
3. Validate each root descriptor and its complete existing schema-v1 or pack
   graph using the current validators rather than introducing shadow rules.
4. Have `just data` report an already-complete local bundle without network
   access.
5. Add deterministic tests for missing, corrupt, duplicate, unsafe, and
   scientifically mismatched entries.

This phase is independent of Q8 and can use the current ignored local artifacts.

Items 1-5 are implemented for the bootstrap descriptor. The verifier
also verifies copied publication-input and selection-file hashes and rejects
undeclared release files. Completing the descriptor requires recovery of the
exact Brain-Wide Map and D042 inputs; their absence is machine-readable in the
descriptor and never triggers fallback.

### 2. Authorized immutable origin

After Q8 provides an IBL-owned staging bucket, CloudFront distribution, base
URLs, and cache/CORS policy:

1. upload the already-built immutable release and pack directories without
   transformation;
2. verify remote served-byte size and SHA-256 for every graph resource;
3. record production-style browser evidence for catalog, CORS, MIME, caching,
   and opaque compressed resources;
4. add the resolved immutable base URLs by creating a new bundle descriptor;
5. do not upload private canonical source inputs or mutable local build state.

Remote mutation requires separate explicit authorization and credentials. This
plan and its implementation do not themselves grant it.

### 3. Atomic downloader

Extend `just data` to:

1. preflight disk space and the exact destination roots;
2. reuse entries that pass complete validation;
3. download missing artifacts into a bounded temporary directory;
4. verify declared served-byte size and SHA-256 before decoding or admission;
5. validate the complete release/pack graph;
6. atomically move a complete artifact into its ignored destination;
7. clean temporary state after a failure and leave existing valid artifacts
   untouched;
8. fail with actionable authentication, origin, integrity, and disk-space
   errors, with no synthetic or older-release fallback.

The downloader must not resolve mutable aliases or select a different source
when a declared object is unavailable.

### 4. Bundle-driven local server

1. Make `just dev` read the same committed bundle descriptor instead of
   repeating release IDs in the `Justfile`.
2. Validate required entries before starting Vite and identify every missing
   or corrupt entry in one actionable report.
3. Keep the generated local catalog outside immutable release directories.
4. Remove `dev-real`, `dev-3d`, and `dev-local-full` from the public recipe
   surface.
5. Keep dataset-specific Playwright and production-style HTTP acceptance
   recipes for focused diagnostics.

All five items are implemented. A validated launcher derives the existing Vite
configuration from the descriptor, so focused Playwright configurations retain
their explicit environment mode without a second descriptor parser. Local
acceptance derives its expected catalog and optional 3-D checks from the same
launcher environment.

### 5. Onboarding and clean-checkout acceptance

Rewrite the repository README as a short product and contributor landing page:

1. product purpose and implemented viewer capabilities;
2. the three-command setup path;
3. prerequisites, data access/maturity disclosure, and expected storage;
4. the small public command surface (`bootstrap`, `data`, `dev`, `check`, and
   `docs-serve`);
5. compact repository layout and links to authoritative system, scientific,
   execution, and blocker documents.

Move completed cutover history, detailed anatomy mechanics, and changing
milestone state out of the README rather than duplicating their authorities.

Acceptance requires a clean checkout on a supported developer machine to run
`just bootstrap`, `just data`, `just dev`, and `just validate-local-full` with
no manual path edits. `just check` must remain green.

## Stop conditions

- Q8 blocks remote upload and download-origin configuration, but not the
  descriptor, local verifier, or bundle-driven server work.
- Q2 blocks calling the current channel release paper-facing production.
- Q5 blocks calling the current volume candidate the production transport.
- Q9 blocks production aliases and final catalog defaults.
- Missing private build inputs must not be replaced with synthetic fixtures or
  a convenient older scientific release.
- Published immutable bytes must never be modified to repair a local setup;
  corrections produce a new artifact and bundle identity.

## Completion evidence

The completed implementation records:

- descriptor validation and downloader tests;
- exact local and remote manifest identities and hashes;
- clean-checkout command transcript and disk/transfer totals;
- `just validate-local-full` evidence across all datasets and context views;
- `just check` results;
- staging/production-origin evidence only after the relevant authorization.
