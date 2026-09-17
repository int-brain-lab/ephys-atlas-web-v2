# AGEA processed-source candidate review

Status: validated-real-local candidate evidence, 2026-09-17. Not staged or
published. Registration remains provisional.

## Candidate

The complete `agea-processed-20260917-v1` candidate was built from the exact
processed source pinned in
[`AGEA_PROCESSED_SOURCE_AUDIT.json`](AGEA_PROCESSED_SOURCE_AUDIT.json). The
builder packages the upstream float16 values unchanged and applies one validity
rule: `label.npy != 0`. Negative, exact `-1`, zero and positive processed values
inside that domain are valid; label-zero voxels are outside.

The local candidate was built from commit `fba4cbd` with release timestamp
`2026-09-17T12:57:21+02:00`. It contains all 4,345 experiments and 21,729 files.
Its release graph occupies 823,171,192 bytes: 757,061,586 bytes of independently
compressed expression chunks, 21,529,475 bytes of validity masks, and a
3,891,981-byte metadata bundle (43,270,056 decoded bytes). These are local
measurements, not production-origin acceptance.

Representative summaries all contain 62,959 valid and 96,367 outside voxels,
with no missing category. Ndufa10 experiment 74658173 has a valid range of
0.00010854–34.5; Ptpru experiment 858 has a valid range of −1.94727–15.27344;
Slc17a7 experiment 75081210 has a valid range of −2–89.25. These signed values
demonstrate why the original `-1` sentinel policy cannot be reused.

## Visual comparison

[`tools/agea_processed_report.py`](../../tools/agea_processed_report.py)
generates a deterministic six-page PDF with a source summary and orthogonal
original, processed and difference slices for Ndufa10, Grik2, Ptpru and both
Slc17a7 experiments. Original missing values and label-zero voxels are excluded
from difference panels. The generated PDF stays under ignored `artifacts/` and
has SHA-256
`736ecb020d337bd2d5739bf8d8bae7da56fdd7707ecc58767edfa670e2349b13`.

```bash
uv run --project builder --extra test --locked python -m tools.agea_processed_report \
  --source artifacts/agea-metadata-sizing \
  --output artifacts/agea-processed-review/report.pdf
```

All six pages were inspected for clipping and legibility. The comparisons show
the declared bilateral symmetry, reconstruction of original missing support,
and broad value changes expected from PPCA reconstruction and slice correction.
They are engineering/scientific review evidence, not independent validation of
the upstream processing method.

## Browser evidence

The existing real-release application suite was run against the complete
candidate in Chromium. All four tests pass: full-catalog bundled-metadata load,
linked orthogonal rendering and navigation, duplicate-gene selection, deep-link
state, bounded feature discovery, corrupt-resource recovery, quota fallback,
and decoded/cache reuse.

One diagnostic run measured 1,648 ms from navigation to the first three rendered
planes and 94 ms for a cold switch to Slc17a7. It fetched one metadata bundle,
one expression chunk and one validity mask for the initial feature. These
single-machine local timings are smoke evidence only.

The failure-path assertion now follows D076's implemented retained-frame
contract: a corrupt replacement keeps the previous scientific volume visible,
labels it **Previous slice**, and displays an explicit viewport error until a
valid selection recovers the view.

Reproduce the build and browser check from the repository root:

```bash
uv run --project builder --extra test --locked python -m tools.agea_preview \
  --processed \
  --source artifacts/agea-metadata-sizing \
  --output artifacts/agea-processed-candidate-new \
  --created-at 2026-09-17T12:57:21+02:00 \
  --alignment-review docs/data/AGEA_ALIGNMENT_REVIEW.json \
  --release-id agea-processed-20260917-v1

EPHYS_ATLAS_REAL_RELEASE="$PWD/artifacts/agea-processed-candidate-new/releases/agea/agea-processed-20260917-v1" \
  npx --prefix web playwright test --config web/playwright.agea-preview.config.ts
```

The output directory must be absent before building. Production preflight and
publication are intentionally not claimed here: preflight requires clean
`main`, while this authorized work is on
`feature/shared-atlas-region-contract`.
