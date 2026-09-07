# AGEA missing-slab and intensity review

Status: runbook for implemented exploratory report and screening tools, 2026-09-07.
Artifact maturity: local scientific-review evidence, not a scientific release.
Q19 remains open. No values have been repaired or selected for publication.

## Findings

The 12-page PDF at `artifacts/agea-stripe-report/report.pdf` is generated
locally; its editable source is
[`tools/agea_report_pdf.py`](../../tools/agea_report_pdf.py).
The PDF and large intermediate outputs remain in ignored `artifacts/`.
The commands below regenerate them from the pinned inputs.

- Ptpru experiment 858 contains the same missing bands in the current Allen
  archive and the IBL source. All 159,326 values match after float16 conversion.
  Six declared examples (Ptpru, three highest slab scores, one lowest score,
  and one seeded random example) pass complete direct-source comparison.
- Allen's documented reference-to-specimen transform predicts four bands from
  absent section numbers 42, 122, 138 and 170. Within the one-voxel-eroded
  supplied anatomical mask, the respective bands contain 84.25%, 92.23%,
  91.38% and 84.61% missing values. Their pooled fraction is 4,424/5,021,
  or 88.11%, using a declared ±100 µm specimen-axis interval. Immediately
  neighbouring available-section bands have no missing interior voxels for
  these four examples.
- This spatial association supports an acquisition-gap hypothesis. It does
  not establish why those image records are absent or how Allen's gridding
  produced the exact missing support. The available images at sections 34
  and 50 both show substantial tissue; neither reveals the absent section 42.
- Full-catalog screening covers 4,345 experiments / 4,082 gene symbols.
  At provisional slab-contrast thresholds 0.3, 0.5 and 0.7, the numbers flagged
  are 2,919, 2,656 and 2,347. These are **screening counts, not prevalence of
  confirmed defects**. Natural acquisition support can produce a high score.

Small durable evidence is in [AGEA_STRIPE_EVIDENCE.json](AGEA_STRIPE_EVIDENCE.json),
the [per-experiment scores](AGEA_STRIPE_SCORES.csv), and
[supplied-region summaries](AGEA_STRIPE_REGIONS.json). Complete profiles,
selected-example mask sensitivity, spatial frequency arrays, download receipts,
and the original MetaImage header remain in the generated report directory.

## Diagnostic definitions and limits

`-1` is missing; measured zero is retained. Unexpected negative/nonfinite
values cause an explicit error. The mask variants are the full source grid,
supplied nonzero labels, their one-voxel eroded interior, and the removed
boundary. Erosion uses SciPy's default six-neighbour connectivity. These are
named diagnostic populations, not an accepted production validity policy.

The slab score searches 193 distinct unit normals, with slope coordinates from
`{-1, -.5, -.25, -.125, 0, .125, .25, .5, 1}`, and interval widths of one,
two or three source voxels. Projected coordinates are floored into unit bins.
For each supported interval, it subtracts the larger missing fraction of its
two adjacent equal-width shoulders from the interval's missing fraction,
clamps the result at zero, then takes the maximum. Each of the three intervals
must contain at least 100 interior voxels. Output includes the winning normal,
interval, support, missing count and RMS distance from its mid-plane.
It also records missingness profiles and largest six-connected gap size.

The intensity diagnostic uses only measured interior voxels. It subtracts
each supplied region's mean `log1p(expression)` from its observations, clips
residuals to ±3 log units, computes their mean by source slice, then takes half
the largest absolute second difference over three consecutive supported slices.
Each slice needs 100 observations. This partial region-composition control
removes a matched regional step, but unmodelled anatomical boundaries and
nonlinear biological gradients can still score highly. It is not the IBL
curtaining algorithm and does not infer a correction factor.

Deterministic tests cover tilted/shallow slabs, widths, erosion, random
missingness, boundary-only gaps, hemisphere coverage, measured zeros, empty
populations, intensity bands, log gradients and matched/unmatched region
boundaries. Wrong array order is checked through source equality rather than
assuming that a stripe score can diagnose strides. Small fixtures use a
30-voxel support minimum. The angle bank was refined after seeing Ptpru;
these engineering controls are not held-out scientific validation. Finite
angle/width/bin-phase resolution, broad gaps, support cutoffs and mask erosion
all limit sensitivity. Selected real examples compare erosion levels 0/1/2.
No scientist-adjudicated prevalence or sensitivity/specificity estimate exists.

### Visual triage of the declared examples

The following are assistant observations from the displayed source-index
planes on PDF pages 8–9 (2026-09-07), not scientist QC adjudication. The sample
is Ptpru, the top three and bottom two slab scores, the top two intensity
scores, and three random experiments with seed `20260907`, deduplicated.
Ties preserve source-catalog order. A plane observation is not a whole-volume
absence/presence verdict.

| Experiment | Displayed plane | Observation |
| --- | --- | --- |
| Ptpru 858 | DV 20 | Several oblique internal missing bands, plus peripheral missing coverage. |
| Ndufa10 74658173 | ML 29 | Two prominent internal transverse missing bands in this plane. |
| Grik2 71247618 | ML 29 | One prominent internal transverse band. |
| Lhx1 79591731 | ML 29 | Multiple separated transverse bands across the interior. |
| Gm1335 74988767 | DV 20 | Missingness mainly follows the perimeter in this displayed plane. |
| Glul 74988768 | ML 29 | Broad interior measured support; perimeter irregularities remain. |
| Dok1 75042248 | AP 44 | Spatially localized expression and a sharp diagnostic slice change; periodic curtaining is not established visually. |
| LOC433311 74988757 | AP 18 | Localized expression with a sharp diagnostic change; no basis to label it defective from this image. |
| Rab3ip 71717136 | DV 20 | Mostly measured interior; small peripheral/isolated gaps. |
| Gm10635 75144655 | DV 20 | Mostly measured interior with peripheral gaps. |
| Clgn 74425567 | ML 29 | Multiple transverse missing bands, also found in this random example. |

The intensity examples illustrate why a high continuous score is only a
review prompt. The unmodelled-region synthetic control provides an explicit
false-positive mechanism; none of the real examples is assigned a definitive
scientific defect label here.

## Section-coordinate evidence

The [Allen Alignment3d definition](https://api.brain-map.org/doc/Alignment3d.html)
identifies `trv` as reference-to-specimen and encodes the first nine numbers as
a row-major matrix, followed by three translations. The
[SectionDataSet implementation](https://api.brain-map.org/doc/SectionDataSet.html)
compares specimen z with `section_number * section_thickness`.
The tool follows that calculation using MetaImage physical xyz coordinates
(header order AP/DV/ML here), including header spacing, transform and offset.
The stored `tvr` inverse returns source reference coordinates within 0.125 µm,
consistent with rounded transform parameters.

Treating those grid coordinates as the API reference coordinates is a tested
source-coordinate hypothesis, not acceptance against the production 10 µm
anatomy. The report retains sensitivity to ±1 section-number shifts and
±0.5-voxel shifts of all three grid axes. It does not silently change the
header's zero offset or invent a production reference-space identity.

The locked environment has no established independent MetaImage reader.
Verification uses complete NumPy float32 decoding, full float16 comparison,
and separate `struct.unpack` checks at first/middle/last offsets. That is
strong byte-order evidence but not two independent full-volume reader libraries.
Only Ptpru has the section-projection analysis; metadata for the rest of the
catalog is not systematically acquired. Six archives do not audit all Allen
experiments. ZIP container hashes can change between downloads even when the
three required member bytes agree; recheck receipts preserve this distinction.

## Reproduce

Acquire the four hash-pinned source inputs with the [AGEA source runbook](AGEA.md#reproduction).
Use the committed builder environment; no additional dependencies are needed.
From the repository root:

```bash
mkdir -p artifacts/agea-stripe-report/downloads
curl --fail --location https://api.brain-map.org/grid_data/download/858 \
  --output artifacts/agea-stripe-report/downloads/allen-858.zip
uv run --project builder --extra test --locked python -m tools.agea_stripe_report \
  --source artifacts/agea-metadata-sizing --output artifacts/agea-stripe-report
uv run --project builder --extra test --locked python -m tools.agea_stripe_report \
  --source artifacts/agea-metadata-sizing --output artifacts/agea-stripe-report --verify-samples
uv run --project builder --extra test --locked python -m tools.agea_report_pdf \
  --source artifacts/agea-metadata-sizing --output artifacts/agea-stripe-report
```

Reuse existing downloaded archives on repeat runs. `--verify-samples` explicitly
downloads the bounded archive subset and adjacent image thumbnails, recording
URLs, SHA-256 and acquisition/recheck times. Changed scientific member bytes
stop the cached-source recheck. It does not fetch the complete Allen catalog.

After reviewing a new report, export its small evidence with:

```bash
uv run --project builder --extra test --locked python -m tools.agea_stripe_report \
  --source artifacts/agea-metadata-sizing --output artifacts/agea-stripe-report \
  --evidence-dir docs/data
uv run --project builder --extra test --locked python -m pytest -q \
  tests/test_agea_source_verification.py tests/test_agea_stripes.py tests/test_agea_stripe_report.py
just check
```

The PDF renderer is deterministic for identical evidence and source inputs;
new downloads, timestamps or source-code provenance can change a new evidence
build. Source volumes and generated binary figures/PDF are never committed.

## Review request draft

> We are reviewing the original IBL AGEA volumes in a local viewer preview.
> Ptpru 858 has oblique missing bands that reproduce exactly from
> Allen's energy grid. Projecting the four absent section numbers through
> Allen's documented transform places them close to those bands. Available
> neighbouring images do not explain why the sections are absent.
>
> Does this look like expected acquisition coverage, and is our section-to-grid
> interpretation correct? Are there source/QC records that distinguish omitted
> sections from registration or gridding effects? Is this separate from the
> intensity curtaining handled in the IBL processing pipeline?
>
> The attached report includes exploratory scores across all 4,345 experiments,
> controls and examples. Its flags are not defect labels. We would appreciate
> review of representative cases and advice on original versus processed data,
> missing/zero handling and the appropriate display mask.

This is a draft only; no message has been sent. Next: scientist adjudication
and section-convention confirmation, then Q19's source/validity/registration
decisions. The processed source comparison remains optional and unperformed.

The [source and alignment report](AGEA_SOURCE_ALIGNMENT_REPORT.md) adds the
complete-preview catalog check and owner reference-image review. Neither
resolves the upstream cause of the missing bands.
