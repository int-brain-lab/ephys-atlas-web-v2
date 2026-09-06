# Native component baseline audit

Status: review evidence, 2026-09-06. No replacement mesh or runtime contract has
been selected. Q18 remains open.

## Reproduction and integrity

The original D042 graph passed `just mesh-pack-validate
artifacts/mesh-d042-schema-v1`. Its manifest SHA remains
`49d58f1893ce9978f41c13fd445f5ff2bd34b18b737aa5b763291b6774b34b2c`.
No baseline bytes were changed or uploaded; durable external archival remains
unarranged. The pinned GLB was read from the frozen donor's local data directory
without changing the donor or importing its code.

Run with the locally available pinned GLB path:

```bash
uv run --project builder --extra test --locked python -m tools.mesh_pack.audit_native \
  --glb /path/to/meshes.glb \
  --baseline artifacts/mesh-d042-schema-v1 \
  --tolerance-um 0 0.001 0.1 \
  --output artifacts/native-components-audit/report.json
```

The command verifies the exact source and baseline manifest SHA, validates the
baseline graph, uses its selected source IDs and source-to-world transform,
and writes a new review-only report with exclusive creation. It never writes
mesh resources. This report is audit evidence, not another release schema.

Local report: `artifacts/native-components-audit/report.json`, 2,098,720 bytes,
SHA-256 `9e46b4c7bf1bf12088068765a242546798e6e97cd238b15c873e54bf98535ff1`.
A second execution produced byte-identical report bytes.
The complete per-component inventory remains in this reproducible ignored
report rather than a large committed JSON asset.

## Findings

| Quantity | Result |
| --- | ---: |
| Selected source objects | 566 |
| Original selected source triangles | 966,645 |
| Native connected components | 1,140 |
| Strictly left components | 539 |
| Strictly right components | 504 |
| Spanning components | 97 across 96 Allen IDs |
| Ambiguous component bounds at tested tolerances | 0 |
| Duplicate positions among used vertices within each object | 0 |
| Exactly zero-area source triangles | 0 |

Edge and vertex connectivity produced identical ordered component summaries
for every selected object. All three tested tolerances produced the same
classifications. The values 0, 0.001, and 0.1 µm are sensitivity probes, not a
selected production tolerance. Near-plane vertices can occur inside a clearly
spanning component; absence of ambiguous bounds does not imply no near-plane
vertices.

The D042 cut/capped output has 989,811 triangles. Its count must not be used as
the native candidate's source-preservation target: cuts and caps change the
triangle inventory. Future candidate gates must prove original triangle
correspondence and winding, in addition to counts.

## Concrete Q18 review cases

| Source | Spanning component ML bounds (µm) | Triangles |
| --- | --- | ---: |
| SCig (10), superior colliculus intermediate gray layer | −2086.640 to 1995.970 | 4,900 |
| PVH (38), paraventricular hypothalamic nucleus | −435.080 to 334.550 | 496 |
| RH (189), rhomboid nucleus | −339.930 to 236.090 | 344 |
| CM (599), central medial thalamic nucleus | −458.460 to 357.250 | 704 |
| DG-mo (10703), dentate gyrus molecular layer | −1.900 to 3472.310 | 6,646 |

DG-mo shows why spanning does not necessarily mean centrally located. The
planned literal rule fixes a strongly lateral component that barely crosses
the plane. Do not silently increase tolerance or use centroid sign to make it
explode. Owner review must accept this outcome or specify an explicit,
source-bound exception policy before candidate acceptance.

Presentation alternatives to review:

- Preserve current side-specific coloring and picking using original world ML
  in the shader/hit logic, independently of intact geometry and displacement.
  This requires an explicit on-plane hit policy and a way to apply both signed
  presentation mappings to one component.
- Use anatomy coloring for the whole neutral component and bilateral selection.
  This changes feature visibility and selection semantics and also requires
  explicit shared-state behavior; it is not an automatic safe fallback.

## Next implementation boundary

The new pure topology machinery has synthetic coverage for point contacts,
shared edges, repeated coordinates without welding, asymmetric spanning
components, near-plane ambiguity, degenerate triangles, unused vertices, and
invalid inputs. It preserves source triangle ordinals and does not change
positions or indices.

The mesh wire contract and renderer are unchanged. Settle Q18 presentation and
review the asymmetric cases before landing the coherent contract slice. Keep
component/range identity separate from signed presentation mappings; encode
explicit displacement, including zero. A synthetic end-to-end contract change
must include the builder, validators, binary codec/source, renderer, fixture,
and D042 repack/configuration continuity together.
