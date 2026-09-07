# AGEA source and alignment report

Status: local evidence summary, 2026-09-07. Public registration acceptance
remains Q19. This report summarizes the pinned source audit, direct-source
checks and owner review; it does not assign scientific QC labels.

## Catalog coverage

The integrated preview contains all 4,345 experiments in the pinned IBL AGEA
table, representing 4,082 distinct gene symbols. A direct comparison on
2026-09-07 found exact equality between the source experiment IDs, in source
order, and the preview manifest: zero missing and zero additional experiments.
The table SHA-256 is
`90433973765b0361921c48dc70bce8291885c427d23d930b1eb6617348024572`.

This establishes completeness against this IBL snapshot. We have not compared
its membership with the complete Allen catalog, so "all Allen genes" would
overstate the evidence. The source table supplies experiment IDs and gene
symbols only; it has no full names or aliases. Multiple experiments for a gene
remain separate, for example Slc17a7 experiments 75081210 and 70436317.
The picker supports scrolling and searching the complete catalog, rendering
only a small window of rows at a time.

The checked release is
`agea-original-local-preview-86b49971-2cdd9bee-c93e9c5b`.
The [preview runbook](AGEA_LOCAL_PREVIEW.md) identifies its local location and
build procedure. [Source identity and hashes](AGEA.md#scope-and-source-identity)
pin the input independently of the mutable upstream version marker.

## Source fidelity and missing bands

The preview preserves the original IBL float16 expression values and native
200 µm grid. It retains measured zero, treats `-1` as missing, and does not
discard observations because the coarse anatomical label is zero. No
denoising, imputation, duplicate-experiment averaging or corrective spatial
transform is applied. D069 authorizes this local recipe only.

The [stripe investigation](AGEA_STRIPE_REPORT.md) compared six declared
experiments with downloaded Allen energy grids. Every voxel matched after
conversion to float16. Ptpru experiment 858's missing bands therefore exist
upstream of this viewer and its browser packaging.

For Ptpru, projecting four absent section numbers through the recorded
transform places them near the missing bands. The pooled predicted bands have
88.11% missing interior voxels under the declared diagnostic mask and interval.
This supports an acquisition-gap hypothesis, but does not establish why the
sections are absent or how gridding produced the exact support. Six archive
checks do not establish source equality for all 4,345 Allen experiments.
Full-catalog stripe scores are review prompts, not confirmed defect counts.

## Alignment review

The [saved owner review](AGEA_ALIGNMENT_REVIEW.json) contains five
"Looks consistent" judgments, all on the CCF-derived reference-image layer
with website outlines visible and no written comments. The saved cursor
coordinates are the reviewed locations; the starting preset names do not
certify which structures were inspected.

| Saved review | ML (µm) | AP (µm) | DV (µm) |
| --- | ---: | ---: | ---: |
| 1 | 801 | -6340 | -5168 |
| 2 | 451 | -1820 | -1078 |
| 3 | -1959 | -3900 | -1798 |
| 4 | 1 | -1980 | -2598 |
| 5 | 3801 | 320 | -1998 |

The loader-derived mapping uses 20 native 10 µm index steps per 200 µm source
step, with zero index offset. The source has a different outer extent;
150,480 of its 159,326 voxel centres lie within the native grid's centre
bounds. The export retains the exact affines, bounds and displayed-plane
coordinates. Sparse displayed outlines and coarse labels need not agree at
every boundary.

The review supports visual consistency of the reference-image overlay at
these locations. Because that image was itself derived from CCF anatomy, it
is not an independent test of gene-expression registration. The exported
`alignment_accepted: false` remains unchanged. The owner subsequently reported
that the integrated preview works; that usability confirmation does not add
experiment-specific registration measurements.

## Conclusion and remaining questions

The full pinned IBL collection is available in the main viewer with original
values and the unchanged source transform. The checked missing bands are not
introduced by the website. Their upstream cause and the biological accuracy
of expression registration remain unresolved.

For source-author review, the concrete questions are whether the absent Ptpru
sections reflect expected acquisition coverage, whether the section-to-grid
interpretation is correct, and which source/QC records explain the gaps.
Registration review should distinguish that question from the reference-image
overlay and from intensity curtaining. The existing
[review request](AGEA_STRIPE_REPORT.md#review-request-draft) remains unsent.

Public source identity, validity/display semantics and registration acceptance
remain under [Q19](../OPEN_QUESTIONS.md).
This report neither authorizes publication nor changes the source data.
