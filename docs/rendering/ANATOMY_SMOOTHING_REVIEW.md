# Anatomy smoothing human review

Status: frozen evidence; D045 retains exact geometry (2026-08-26).

This note closes Slice 4 of the anatomy smoothing investigation. The generated
HTML and external atlas bytes remain ignored; the compact authoritative answer
record is `ANATOMY_SMOOTHING_SELECTION.json`.

## Evidence identity

- exact parent: `allen-ccfv3-10um-bilateral-exact-599b5e0bbab1`;
- report generator: clean commit
  `c59fb13e51b1712631d56791dac7599d44eaef33`;
- embedded deterministic evidence SHA-256:
  `50969055f32c98baa0630f9bdb7846baad8926ba5314ab0fec601b42360ff2d5`;
- annotation SHA-256:
  `a9e9654ef491f0af107dc0a61bd720dabe7f36e8f3e9239532bf3dbdc94ef24c`;
- bilateral LUT SHA-256:
  `f8c26e2eb972cbff5caa2101fda8b7c5c2a2bdb985e3faad6bf0e57defcc27cb`;
- Allen average-template SHA-256:
  `055b79034ea3ac47cf8776ecdb0c61d2b338d38ee5fd87d0962753efe600a775`.

The complete report contains 16 deterministic stress samples and 352 variants.
GEOS tolerances 2.5 and 5 um preserved exact geometry in the sampled report and
therefore offered no visible geometry change. The first visibly consequential
7.5 um candidate failed the provisional IoU/error gates; larger tolerances also
failed. The guided review therefore compared exact option A with the 7.5 um
fixed-outer-boundary diagnostic option B.

## Human result

The repository owner selected `A clearly better` for all three representative
views:

| Projection | Native slice | World coordinate | Answer |
| --- | ---: | ---: | --- |
| coronal | 660 | -1200 um | A clearly better |
| sagittal | 566 | -79 um | A clearly better |
| horizontal | 393 | -3598 um | A clearly better |

Under decision-rule version 2, the stress round opens only when B is clearly
better in at least two representative projections. The result was 0/3 for B,
so the review stopped without shortlisting. This is stronger than an
indifference result: exact geometry was visually preferred in every projection.

## Decision and implications

Retain the exact bilateral 10 um geometry. Do not shortlist the current GEOS
candidate, implement a shared-chain smoother, run the 3,260-plane shortlist
validation, create a derivative anatomy pack, or migrate the projection pack.
The active artifact therefore keeps IoU 1, zero boundary displacement, and its
existing topology/coverage guarantees. This decision does not claim that every
possible future algorithm is inferior; it records that no measured or visual
evidence justifies further smoothing work now.

## Reproduction

Run the report builder from the clean generator commit with the pinned files
and hashes documented in `ANATOMY_SMOOTHING_LAB_PLAN.md`:

```bash
python -m tools.anatomy_smoothing_lab.build --offline \
  --created-at 2026-08-22T00:00:00Z \
  --strategies exact,geos-coverage-simplify,independent-ring-rdp-unsafe \
  --tolerances-um 0,2.5,5,7.5,10,15,20 \
  --maximum-error-um 20 --minimum-iou 0.98 \
  --minimum-iou-area-mm2 0.01 \
  --source-lut <annotation_10_lut_bilateral_v02.npy> \
  --annotation <annotation_10.nrrd> \
  --template-volume <average_template_10.nrrd> \
  --template-sha256 055b79034ea3ac47cf8776ecdb0c61d2b338d38ee5fd87d0962753efe600a775 \
  --template-source alleninstitute-current-release/mouse_ccf/average_template/average_template_10.nrrd \
  --parent web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1 \
  --sampled-pack web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a \
  --output artifacts/anatomy-smoothing-lab/full-review.html
```

The generated report is evidence only and is not committed or published.
