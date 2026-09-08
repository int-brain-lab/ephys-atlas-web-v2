# AGEA stripe detection and scientific review report

Status: original scope and investigation plan, requested 2026-09-06.
The detector and 12-page PDF are now implemented; use the
[report evidence and reproduction runbook](AGEA_STRIPE_REPORT.md) for current
findings, exact limits and continuation. Scientist adjudication, independent
full-volume reader validation and optional processed-source comparison remain
incomplete. Q19 still governs scientific release choices.

## Resume here

Continue with scientist review using the report runbook above. The sequence
below preserves the original investigation requirements and hypotheses; it
does not supersede the implemented evidence or imply that every optional
investigation has been completed.

Build a reproducible screening tool for missing-data slabs and intensity
banding across the original 4,345 AGEA experiments, then produce a concise PDF
for colleagues familiar with AGEA. A landscape slide-style PDF with editable
source is a suitable default; a separate slide deck is optional. The report
should ask whether these patterns are expected and how they should be handled,
without treating an automated flag as a scientific defect or repairing data.

First reproduce Ptpru experiment 858 directly from Allen, preserve the source
hashes and header, and inspect the missing mask in three planes. Then implement
and validate screening before making catalog-wide prevalence claims. Read
[source evidence](AGEA.md), [lab runbook](AGEA_COVERAGE_LAB.md), and Q19 first.

## Existing work and observations

- `7565553` audits the full source and browser transport; `ade96b2` adds the
  exploratory coverage lab. Relevant code: `tools/agea_benchmark.py`,
  `tools/agea_coverage_lab.py`, and `web/src/labs/agea-{model,data}.ts` plus
  `agea-coverage-lab.ts`. Existing audit/lab tests passed, including `just check`
  at the lab commit; this does not validate a future stripe detector.
- Original source: 4,345 experiments, 4,082 gene symbols; little-endian float16
  `(experiment, ML, DV, AP) = (4345, 58, 41, 67)`, spacing 200 µm. Exact input
  hashes are in `AGEA_SOURCE_AUDIT.json` and enforced by the audit tool.
- Ptpru 858 shows a purple/navy missing band moving left across coronal AP
  indices 59, 60, 61, 62 (zero-based lab indices). Purple and navy distinguish
  nonzero/zero supplied anatomical labels; both contain expression `-1`.
  The broad band is not explained by the thin label outlines or cursor lines.
- Ad hoc direct-source investigation on 2026-09-06 found all 159,326 values
  from Allen's 858 archive equal the IBL row after float16 conversion. Header:
  `DimSize = 67 41 58`, `MET_FLOAT`, little endian, spacing 200 in each axis,
  identity transform, zero offset. Header-order x-fastest decoding yields
  NumPy C-order `(58, 41, 67)`. Direct plotting reproduces the moving stripe;
  using F order for those same dimensions fragments the image. This rules out
  a change introduced by our packaging for this example, not upstream errors.
  Reproduce and save machine-readable evidence: these checks are currently
  session observations, not a committed diagnostic program.
- The archive's listed section numbers mostly increment by eight. Numbers
  42, 122, 138 and 170 are absent within that sequence. It also supplies
  `alignment3d` and per-image transforms. Whether any omitted section maps to
  the observed slab is **unverified**; omission alone does not establish why a
  section is absent. A transformed acquisition gap is a hypothesis.
- Existing lab metadata shows missing values within supplied nonzero labels in
  all 4,345 experiments: median 6.6392%, pooled 8.4067%, P95 19.8831%.
  Ptpru 858: 6,066 / 62,959 = 9.6348% (approximately 9.63%). These are
  missingness counts, **not stripe prevalence**. Boundary mismatch contributes.
  High-missingness inspection candidates: Pim2 32583 (70.70%), Pkia 805
  (51.06%), Mapk3 32576 (49.33%), Mlx 227539 (44.51%), Limk2 61002 (40.81%).
  None has yet been confirmed to exhibit the same moving stripe.

## Inputs and reproduction

Use the acquisition and locked-environment commands in `AGEA.md`. Local ignored
inputs may already exist in `artifacts/agea-metadata-sizing/`; transport/lab
outputs are in `artifacts/agea-browser-benchmark/`. Do not assume these exist on
another checkout. The original source is about 1.4 GB, transport about 0.76 GB.

Download the example archive from
<https://api.brain-map.org/grid_data/download/858>. Its ZIP contains
`energy.raw`, `energy.mhd`, and `data_set.xml`. Record download time and SHA-256
instead of assuming a future download is identical. Decode raw float32 before
comparing its float16 conversion with source-table experiment 858 (observed
row 1014; look up by ID, do not hardcode row identity).

Local diagnostic figure `artifacts/agea-858-order-hypotheses.png` compares C/F
interpretations. Other ignored screenshots and the running preview are not
durable deliverables; regenerate report figures through a committed script.
The lab runs at `/app/?lab=agea-coverage` using the runbook's explicit data directory.

## Investigation sequence

1. **Independent decoding and geometry.** Cross-check MetaImage loading with an
   established reader if available through the locked environment; otherwise
   document the remaining independence limitation. Assert selected voxel offsets
   and complete-volume equality, not just visual plausibility. Keep source-grid
   indices distinct from approved production registration. Plot raw missing
   masks without labels, interpolation, or cursor overlays in three planes.
2. **Explain the Ptpru slab.** Estimate orientation, thickness, extent and
   residuals of the internal missing band. Resolve Allen's transform direction,
   units and section-number convention from primary documentation before using
   `alignment3d`. Project available and omitted acquisition sections into the
   grid; compare with the band and inspect adjacent original ISH images. Record
   support and contradictions rather than selecting a cause by appearance.
3. **Implement separate diagnostic scores.** Missingness: total, labelled and
   eroded-interior fractions; slice profiles in each axis; connected-gap extent
   and planar/slab coherence. Intensity: robust slice changes among measured
   values, with region-composition controls and explicit zero handling. Treat
   anatomy boundary mismatch, missing slabs and intensity curtaining separately.
   Do not use high missingness alone as a stripe detector. Fit oblique slabs,
   not only axis-aligned gaps. Keep scores continuous with recorded parameters;
   any flag threshold is provisional screening, not accepted scientific QC.
4. **Validate specificity and sensitivity.** Deterministic synthetic fixtures:
   tilted missing slabs of varying width, random missing voxels, boundary-only
   gaps, whole-hemisphere coverage, legitimate expression gradients/regional
   boundaries, alternating intensity bands, and deliberately mis-strided arrays.
   Define expected score behavior and failure cases before tuning on Ptpru.
   Test sensitivity to mask erosion, slab angle/width and thresholds. Missing
   anatomy/empty populations must have explicit unavailable results.
5. **Screen the complete original catalog.** Emit one row per experiment (not
   per gene), ranked separately for each diagnostic, plus spatial frequency maps
   and region summaries under the explicitly named supplied coarse annotation.
   Report denominator/voxel support for every region, mask variants and grid
   limitations. Compare repeated experiments for a gene; obtain acquisition
   plane/specimen metadata where available and record missing metadata.
6. **Review representative cases.** Include high scores, low scores, random
   controls and false positives; record manual labels and sample-selection rule.
   Download original Allen archives for a bounded, declared subset and repeat
   direct-source comparison. Report how many were verified. Estimate prevalence
   only for a defined detector and show uncertainty/threshold sensitivity;
   manual adjudication is needed before calling these confirmed problems.
7. **Optional processed comparison.** Acquire and hash the distinct IBL
   processed source only when needed; it has not been audited here. Compare
   identical experiments while retaining the original observed/missing mask.
   Separate imputed values, amplitude changes and support changes. Visual
   smoothness is not evidence of accuracy and does not resolve Q19.

## Documentation leads and questions

- [Allen grid download documentation](https://brain-map.org/support/tutorials/downloading-3-d-expression-grid-data)
  defines `-1` as no data and the raw float32 transport.
- [Allen ISH/AGEA guide](https://brain-map.org/support/documentation/in-situ-hybridization-ish-data)
  warns users to visually inspect image-collection artifacts. No specific
  explanation of this moving stripe was established in the initial search.
- [Pinned IBL processing script](https://github.com/int-brain-lab/iblatlas/blob/52083adf44825d0622a503705e095699a5957587/iblatlas/genomics/gene_expression_scrapping/06-denoise-impute.py)
  implements PPCA, bilateral averaging and a curtaining correction that adjusts
  coronal slice amplitudes using Cosmos-region summaries. This is a lead about
  intensity artifacts, not proof of the missing band's cause.

Search primary Allen adult-mouse gridding/registration methods and AGEA papers
for missing/failed sections, resampling and artifact handling. Preserve exact
citations and distinguish adult data from developmental-atlas documentation.
Ask colleagues whether the slab is expected acquisition coverage, how to check
it against sections, whether it relates to IBL curtaining, and which source/QC
and display treatment they recommend. Draft the message; do not send it without
explicit authorization. Neither report nor detector chooses a production mask,
imputation policy, affine or source variant.

## Report and acceptance criteria

Deliver a roughly 8–12-page PDF with editable source and a reproducible build:

1. Question, dataset identity and concise confirmed/unconfirmed findings.
2. Ptpru consecutive slices and orthogonal missing-mask views with readable axes,
   units, exact experiment/index labels and accessible legends.
3. Direct-source verification and competing hypotheses.
4. Section/registration comparison, including limitations or unresolved mapping.
5. Detector definitions, controls, failure cases and provisional thresholds.
6. Catalog coverage: experiment/gene denominators, score distributions, spatial
   and regional summaries; distinguish flagged from manually confirmed cases.
7. Representative cases and repeated-experiment comparisons.
8. Optional original/processed comparison, documentation evidence, and precise
   questions for colleagues. Put technical provenance/reproduction in an appendix.

Commit the diagnostic/report source, deterministic tests, small aggregate
CSV/JSON evidence and a linked report entry using repository conventions. Keep
large volumes and generated figures under ignored artifacts; document where the
final PDF is available and how to regenerate it. Do not add binary datasets to
Git or publish a scientific release. Record source hashes, commands, commit,
environment, detector parameters, manual review and download coverage.

Validate numerical outputs independently where practical; inspect every PDF
page for clipping, legends and readability. If the lab gains sorting/flag UI,
reuse its existing data path and add meaningful browser coverage. Run targeted
tests and `just check`, update the AGEA runbook/status, and commit only intended
files. Completion means a reproducible, reviewable report plus an honest
account of remaining scientific uncertainty, not a claim that stripes are fixed.
