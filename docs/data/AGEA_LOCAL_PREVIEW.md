# AGEA main-website local preview

Status: implemented local-review runbook, 2026-09-07. D069 authorizes this
preview; public scientific release and registration acceptance remain Q19.

## Open the prepared preview

From the repository root:

```bash
EPHYS_ATLAS_REAL_RELEASE=/home/cyrille/GIT/IBL/ephys-atlas-web-v2/artifacts/agea-local-preview/releases/agea/agea-original-local-preview-86b49971-2cdd9bee-c93e9c5b \
EPHYS_ATLAS_REAL_FEATURE=experiment-74658173 \
npm --prefix web run dev:real -- --host 127.0.0.1 --port 4192 --strictPort
```

Open `http://127.0.0.1:4192/`. This is the main atlas application, not a lab route.
Use **Feature** to scroll through all 4,345 experiments or search a gene or
experiment ID. Large lists render only the visible window plus nearby rows;
the scrollbar and keyboard navigation cover every match. Arrow keys, Home/End
(from an option) and Page Up/Down navigate the list. Repeated gene symbols remain
distinct experiments. The region panel remains anatomical; no regional gene
aggregation is implied. **Data details** exposes provisional identity and sources.

Paths above identify this workstation's prepared preview. On another checkout,
use the absolute release directory printed by the builder below. The ordinary
development catalog and published data are unchanged.

## Scientific scope

- Original pinned IBL float16 expression values, without denoising, imputation,
  normalization, upsampling, masking by coarse labels, or experiment aggregation.
- All finite nonnegative source values, including measured zero and label-zero
  positions, are valid. `-1` is missing. Other negatives and nonfinite values fail
  the builder. No voxel is classified anatomical outside by this recipe.
- Native raw `(ML,DV,AP)=(58,41,67)` grid and unchanged source-loader affine.
  D069 permits a provisional `allen-ccf-2017` reference assignment for local
  review only; matching CCF-derived reference imagery is not independent
  expression-registration evidence.
- Linear/Full, 64-bin descriptive distributions use valid source values.
  These are local-preview settings, not a production presentation selection.

The [archived owner review](AGEA_ALIGNMENT_REVIEW.json) contains five visually
consistent reference-image judgments. Actual saved coordinates, not preset
names, identify the reviewed positions. The original export hash and newline
normalization are recorded in D069. No registration-acceptance flag was changed.

## Rebuild

Use the pinned inputs and existing transport from [AGEA source reproduction](AGEA.md#reproduction).
Choose a new, absent output directory; the builder refuses overwrites:

```bash
uv run --project builder --extra test --locked python -m tools.agea_preview \
  --source artifacts/agea-metadata-sizing \
  --transport artifacts/agea-browser-benchmark \
  --output artifacts/agea-local-preview-new \
  --alignment-review docs/data/AGEA_ALIGNMENT_REVIEW.json \
  --created-at 2026-09-07T13:45:00+02:00
```

Supply the intended build timestamp when rebuilding. `--transport` is optional;
when supplied, every reused gzip experiment is hash-verified and its decoded
bytes are compared with the pinned source. Without it, deterministic gzip
chunks are produced directly. Source, review and builder-script hashes,
checked-out commit, local/dirty-build caveat, and build environment are recorded.
Release identity includes source/commit/script hash prefixes. The existing
production preflight rejects `local-preview` release IDs.

## Metadata and memory

This uses the shared optional schema-v1 `metadata_bundle`, not an AGEA reader.
The gzip bundle carries exact text copies of existing JSON resources. Individual
files remain authoritative and mandatory for complete offline/import/publication
graph validation. The browser checks each copy against its original descriptor.
Partial bundles are allowed; missing entries use the normal verified HTTP path.
AGEA bundles all descriptors, volume indexes and summaries, eliminating request
fanout. Repeated shared fields currently compress inside that bundle; deduplicated
in-memory geometry and an inline-only release graph are not implemented.

The prepared preview has 4,345 features, a 2,033,596-byte manifest, and a
3,474,450-byte metadata bundle (41,616,252 decoded bytes). Each experiment has
one source-identical compressed float16 chunk plus a compressed validity mask.
All scalar chunks total 757,983,590 bytes; only the selected one is fetched.

Descriptor materialization and remaining bundle checks run in batches of 32.
Feature text copies are discarded after parsing; only one release's remaining
bundled text is retained. Parsed manifests remain cached. This is not a peak-heap
measurement: decoding temporarily holds byte buffers, JSON strings and objects.
The existing retained renderer owns bounded decoded volume memory.

Verified encoded cache admission is bounded to 64 MiB / 256 entries by default,
with oldest-admission eviction and serialized mutations across fetchers within
the page. Cached entries are reverified; quota/storage errors fall back to
verified network delivery. This is not an offline-availability guarantee.

## Verification and remaining limits

```bash
EPHYS_ATLAS_REAL_RELEASE=/absolute/path/to/the/printed/release \
  npx --prefix web playwright test --config web/playwright.agea-preview.config.ts
just check
```

The dedicated real-data Chromium suite checks full-catalog discovery, duplicate
gene selection, three linked native planes, URL reload, no metadata fanout,
single-expression requests, no new scalar fetch on navigation, cache reuse,
corrupt-expression recovery, quota fallback and desktop/phone layout.
JSON reports/screenshots are kept in the ignored browser-test artifacts directory.

One local Chromium run recorded 1,076 ms from navigation to three rendered
initial planes and 351 ms for a cold experiment switch (includes automation
overhead). These are smoke-test observations, not percentile budgets or
production-origin acceptance. Earlier isolated transport benchmarks include
Firefox; this integrated real preview has currently been checked in Chromium.

Full-catalog local ZIP import is not supported by this delivery: its individual
graph exceeds the existing 20,000-entry limit. Synthetic canonical-fixture tests
cover metadata-bundle HTTP/local-validation parity. No large ZIP limit was
relaxed. Final-origin latency, peak heap, integrated Firefox/Safari and public
release decisions remain follow-up work.
