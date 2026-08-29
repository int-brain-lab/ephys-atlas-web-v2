# Local development bundle

Status: active distribution plan. The exact missing inputs were recovered, and
the complete local descriptor, verifier, atomic downloader, and server path is
implemented. Supplying authorized immutable origins remains blocked on Q8.

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
- `just data` synchronizes the pinned artifacts, reusing valid local entries
  without network access and obtaining missing entries only from exact resolved
  HTTPS sources, then validates the complete local artifact graph;
- `just dev` serves every verified descriptor entry through the local Vite
  origin. Startup remains read-only and never downloads or falls back for an
  unavailable dataset or pack.

The active v4 descriptor still has unresolved sources. Its complete corpus can
therefore be reused on the integration machine, but a fresh checkout receives
an actionable missing-origin report from `just data` until Q8 supplies a new
immutable descriptor with authorized HTTPS origins.

`just dev` is the only public viewer recipe. The historical channel-only,
channel-plus-mesh, `dev-real`, `dev-3d`, and `dev-local-full` public recipes
were removed when the bundle-driven command was implemented. Focused release acceptance remains in
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

## Complete local bundle

The immutable v4 descriptor extends, rather than retargets, the historical v2
and v3 descriptors. It pins every reviewed validated artifact without
relabelling scientific maturity:

| Role | Immutable identity | Current maturity |
| --- | --- | --- |
| Channels | `2026_W32-d050-q14-v1` | D054-reviewed deterministic technical revision; not the Q2 paper selection |
| Clusters | `sha256-9b5e55215b306f26-d050-d048-q14-v1` | D054-reviewed deterministic technical revision; not published |
| Brain-Wide Map | `legacy-v1-1d908bea-d050-q14-linear-full-v1` | D054-reviewed deterministic technical revision rebuilt from all six exact pinned Parquets; not published |
| Volume | `2026_W26-candidate-depth4-d050-q14-linear-full-v1` | D054-reviewed deterministic candidate; not the Q5 production transport |
| Projection pack | active schema-v1 `atlas-projection-pack-v1` | committed production-intent browser artifact; origin verification remains |
| 3-D mesh pack | `ibl-bwm-d042-c7bb3a88157c42cc` | optional production-intent pack losslessly repackaged from the exact D042 donor; not published |

This is a development bundle identity, not a mutable `latest` alias and not a
claim about the eventual paper-facing production release set. Future bundles
receive new immutable bundle IDs; an existing descriptor is never silently
retargeted. Historical `data/development-bundle-v2.json` remains the incomplete
bootstrap record and v3 remains the pre-D054 complete bundle. Active
`data/development-bundle-v4.json` validates 8,428 files and 551,523,979 bytes
across four scientific releases and both packs.

## Bundle descriptor

The committed machine-readable descriptor under `data/` contains enough information to
locate and verify every bundle root without duplicating the release manifests'
complete transitive file graphs. At minimum it records:

- descriptor schema version and immutable bundle ID;
- artifact role, dataset/pack identity, and maturity label;
- destination relative to the repository's ignored data/artifact roots;
- root manifest media type, served-byte size, and SHA-256;
- source base URL or an explicit unresolved-origin state;
- whether an entry is launch-critical or optional for the bundle;
- descriptor generation/version provenance and the baseline commit that first
  introduced the bundle-driven launcher (not a claim that this descriptor or
  its current validation schema existed at that commit).

Repository-relative destinations must be explicit and bounded. The consumer
must reject absolute paths, traversal, duplicate destinations, duplicate
scientific identities, and unsupported descriptor versions.

## Implementation phases

### 1. Descriptor and local verification

1. Define the smallest descriptor schema and commit the initial pinned bundle.
2. Implement a Python verifier through the locked builder environment.
3. Validate each root descriptor and its complete existing schema-v1 or pack
   graph using the current validators rather than introducing shadow rules.
4. Have `just data` report the already-present available corpus without network
   access.
5. Add deterministic tests for missing, corrupt, duplicate, unsafe, and
   scientifically mismatched entries.

This phase is independent of Q8 and can use the current ignored local artifacts.

Items 1-5 are implemented for the complete v4 descriptor. The verifier also
verifies copied publication-input and selection-file hashes and rejects
undeclared release files. The recovered Brain-Wide Map and D042 artifacts pass
their focused validators and deterministic rebuild checks; absence or damage
still never triggers fallback.

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

`just data` now runs the descriptor synchronizer and then the full bundle
validator. The synchronizer:

1. preflights the exact destination roots and each complete resource layer as
   soon as nested JSON discovery makes that layer known;
2. reuses entries that pass complete validation;
3. downloads missing artifacts into a bounded temporary directory;
4. verifies declared served-byte size and SHA-256 before decoding or admission;
5. validates the complete release/pack graph;
6. atomically moves a complete artifact into its ignored destination;
7. cleans temporary state after a failure and leaves existing valid artifacts
   untouched;
8. fails with actionable authentication, origin, integrity, and disk-space
   errors, with no synthetic or older-release fallback.

These items are implemented. Temporary staging is bounded and remains on the
destination filesystem. Encoded bytes must match their declared served size
and SHA-256 before decoding; an artifact then passes the existing release,
projection-pack, or mesh-pack graph validator before one atomic install. A
valid local artifact causes no network request. A corrupt existing destination
is not overwritten automatically, and failures remove temporary state without
changing accepted local artifacts. A repository-local advisory lock serializes
cooperating sync attempts and is automatically released on process exit;
stable parent-directory identity and directory-relative cleanup and admission
reject a destination or ancestor changed during transfer. A final destination
check refuses a target already created by another writer.

`launch_critical` is operational: a missing optional artifact is reported and
omitted from the derived server environment without blocking the 2-D corpus.
If an optional destination exists but fails validation, it still fails closed
rather than being silently ignored or replaced.

The downloader never resolves mutable aliases or selects a different source
when a declared object is unavailable. Missing launch-critical entries with
unresolved sources remain explicit Q8 blockers; the implemented downloader does not make the
current v4 descriptor remotely obtainable or authorize upload/publication.

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

Final acceptance requires a clean checkout on a supported developer machine to
run `just bootstrap`, `just data`, `just dev`, and `just validate-local-full`
with no manual path edits. The machinery is implemented and `just check`
remains green, but clean-checkout data acquisition remains blocked until Q8
provides authorized resolved sources in a new immutable descriptor.

## Stop conditions

- Q8 blocks remote upload and download-origin configuration, but not the
  descriptor, local verifier, or bundle-driven server work.
- Q2 blocks calling the current channel release paper-facing production.
- Q5 blocks calling the current volume candidate the production transport.
- Q9 blocks production aliases and final catalog defaults.
- Private build inputs must not be replaced with synthetic fixtures or a
  convenient older scientific release if the recovered artifacts need a new
  technical revision.
- Published immutable bytes must never be modified to repair a local setup;
  corrections produce a new artifact and bundle identity.

## Completion evidence

Completion of the remote distribution work will record:

- descriptor validation and downloader tests (implemented locally);
- exact local and remote manifest identities and hashes;
- clean-checkout command transcript and disk/transfer totals;
- `just validate-local-full` evidence across all datasets and context views;
- `just check` results;
- staging/production-origin evidence only after the relevant authorization.
