# Native component movement review

Status: proposed assignments, not approved. D068 fixes the presentation and
movement principles; Q18 retains exact assignments and midline boundary rules.

## Proposed result

Of the 1,140 components, suggest 539 leftward, 516 rightward, and 85 fixed.
This includes 12 of the 97 spanning components proposed for rightward movement;
the other 85 are proposed fixed. All rows, including strictly lateral components,
remain labelled unreviewed in the proposal. No production pack consumes it.

The review-prioritization metric is the larger left/right ML extent divided by
their sum. A 90% threshold flags predominantly one-sided bounding extents. It
is not a fraction of tissue, surface area, or volume and is not an accepted
anatomical classifier. Numerical tolerance 0.001 µm selects an existing audit
variant for this proposal only; it is not a production tolerance selection.

All 12 flagged cases are right-dominant. Preserve the accepted source transform;
do not recenter the GLB to make that asymmetry disappear. These components need
visual inspection before accepting movement. Small components and thin bridges
can defeat any bounds-only heuristic.

## Spanning components proposed to move intact

Component identity below uses `(source Allen ID, first source triangle ordinal)`
under shared-edge connectivity and the exact GLB/audit hashes below. It must not
be applied to a different source, transform, or component decomposition.

| Source | First triangle | ML bounds (µm) | Dominant extent | Proposal |
| --- | ---: | --- | ---: | --- |
| AON (159) | 3208 | -49.090 to 2057.290 | 97.67% | Rightward |
| PL1 (171) | 908 | -53.460 to 647.140 | 92.37% | Rightward |
| RSPd1 (442) | 2198 | -40.680 to 2426.710 | 98.35% | Rightward |
| MOB (507) | 5848 | -31.350 to 2069.660 | 98.51% | Rightward |
| RSPv1 (542) | 2420 | -52.010 to 1539.480 | 96.73% | Rightward |
| TTd (597) | 864 | -53.110 to 525.690 | 90.82% | Rightward |
| TTv (605) | 714 | -46.060 to 835.360 | 94.77% | Rightward |
| DP (814) | 666 | -53.960 to 731.280 | 93.13% | Rightward |
| SCzo (834) | 2042 | -52.890 to 1604.840 | 96.81% | Rightward |
| DTN (880) | 184 | -7.920 to 329.460 | 97.65% | Rightward |
| FC (982) | 190 | -9.680 to 187.350 | 95.09% | Rightward |
| DG-mo (10703) | 6648 | -1.900 to 3472.310 | 99.95% | Rightward |

Compare each with explode at zero and a moderate displacement, retaining its
original left/right coloring and selecting the original side clicked. The tiny
crossing portion must move with the whole component; its presentation side must
not flip as it moves. For fixed components, verify that both side-specific
presentation identities remain usable on one connected surface.

## Reproduction and exact report

```bash
uv run --project builder --extra test --locked python -m tools.mesh_pack.propose_movement \
  --audit artifacts/native-components-audit/report.json \
  --audit-sha256 9e46b4c7bf1bf12088068765a242546798e6e97cd238b15c873e54bf98535ff1 \
  --tolerance-um 0.001 --dominant-extent-fraction 0.9 \
  --output artifacts/native-components-audit/movement-proposal.json
```

The command verifies the audit hash before parsing, requires explicit review
parameters, and creates the output exclusively. It emits review evidence only;
it is not a second mesh-pack contract, release builder, or browser fallback.
The complete local report includes all 1,140 component suggestions, geometry
classification, bounds, reason, and unreviewed status.

Report: 305,659 bytes; SHA-256
`00cb03cdee2a0d1c971731228ff4d3af03cd1b1d50cdd5ef04a277a33c12543d`.

Its source SHA is
`487a72172249acd4dba5b40c392fa8eb065b09bc8638f3195163c4cbf8f569db`.
The [baseline audit](AUDIT.md) records source scope, exact transform and rollback
integrity. Keep all accepted assignments hash-bound to that evidence and build
a new immutable pack only after selection. D042 remains the configured default.
