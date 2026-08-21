# Integration status

Status: active pre-alpha implementation on `main`. The repository is being optimized for rapid future extension rather than compatibility with an installed user base.

## Current architecture

The product is organized around five browser responsibilities:

- `core` / `domain`: renderer- and transport-independent state, atlas coordinates, slice calibration, actions, reducers;
- `application`: asynchronous dataset/release/feature lifecycle and stale-work cancellation;
- `data`: versioned contracts, validation, shared materialization, HTTP/local resource adapters, caching;
- `rendering`: anatomy/volume/mesh rendering and format-specific runtime adapters behind application rendering boundaries;
- `ui`: plain-DOM controllers and pure view models for complex data presentation.

Dataset IDs are runtime identifiers rather than a fixed launch enum. Dataset, feature, parcellation, release, and representation availability are expected to come from catalogs/manifests.

HTTP and local datasets share the same regional materializer through a transport-independent resource-reader interface. The validation implementation is split by contract concern behind the existing public validation facade.

The regional UI keeps DOM concerns in its controller while region search/value/statistics derivation is pure/testable. Large dynamic tree interaction uses delegated events.

## Anatomy rendering

The active regional anatomy display is the immutable sparse `anatomy-pack-v3`, derived byte-for-byte from the validated bilateral 10 µm `anatomy-pack-v2` parent. Application/URL/cursor state remains in native 10 µm coordinates while display geometry uses the sparse 80 µm inventory.

Anatomy manifest/version validation is separate from runtime fetch/cache/worker behavior. The v1/v2 compatibility paths remain explicit where they are still useful for validation or rollback; format-specific code should not be unified merely to reduce file count.

## Scientific data/builders

Schema v0.1 is the current browser/publishing release contract. Regional release serialization is shared by channel and cluster builders; scientific source selection and computation remain dataset-specific.

Current launch-critical dataset families are:

- `ephys_atlas_channels`
- `ephys_atlas_clusters`
- `ephys_atlas_volumes`
- `brainwide_map`

The final paper-facing source vintages and unresolved scientific choices remain governed by `docs/OPEN_QUESTIONS.md`, `docs/LAUNCH_SPEC.md`, and focused data/source documentation. The browser must not hard-code the eventual feature catalog.

## Publishing

Publishing remains capability-token based with public reads and authenticated mutations. The implementation supports resumable staged uploads, byte-size/SHA verification, immutable releases, aliases, catalog generation, and external validation hooks.

Mutation handling is designed for multi-process WSGI deployment with a filesystem lock around state-changing requests. JSON metadata and binary upload chunks have independent request-size limits. No OAuth/user platform, database, or queue is required for the current launch architecture.

## Quality gates

CI runs Python builder/publishing tests plus TypeScript typechecking, browser unit/rendering tests, a production build, and Playwright browser tests. Architectural tests protect important dependency directions so domain/core code cannot silently acquire renderer/UI dependencies.

## Source of truth

Use these documents in order when deciding what to build next:

1. `AGENTS.md`
2. `docs/LAUNCH_SPEC.md`
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/OPEN_QUESTIONS.md`
5. `docs/DECISIONS.md`
6. `docs/ARCHITECTURE.md`
7. this status document and focused implementation/source docs

Historical implementation detail remains available in Git history; this file intentionally records the current integrated state rather than an append-only development diary.
