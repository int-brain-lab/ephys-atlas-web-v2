"""Schema-v1 mesh semantic checks; no alternate release contract."""

from __future__ import annotations
import math
from typing import Any

from ._schema_v1_common import _fail, _unique


def _mesh_pack_semantics(document: dict[str, Any]) -> None:
    coordinate = document["coordinate_system"]
    transform = coordinate["source_to_world_um"]
    if not all(math.isfinite(value) for value in transform):
        _fail("mesh source-to-world transform must be finite")
    if transform[12:] != [0, 0, 0, 1]:
        _fail("mesh source-to-world transform must be affine")
    determinant = (
        transform[0] * (transform[5] * transform[10] - transform[6] * transform[9])
        - transform[1] * (transform[4] * transform[10] - transform[6] * transform[8])
        + transform[2] * (transform[4] * transform[9] - transform[5] * transform[8])
    )
    if math.isclose(determinant, 0):
        _fail("mesh source-to-world transform must be invertible")

    scope = document["geometry_scope"]
    active = scope["active_allen_ids"]
    excluded = scope["excluded_allen_ids"]
    inventory = document["sources"]["source_glb"]["inventory_allen_ids"]
    for values, label in ((active, "active Allen IDs"), (excluded, "excluded Allen IDs"), (inventory, "source inventory")):
        if values != sorted(values):
            _fail(f"mesh {label} must be sorted")
    if set(active) & set(excluded):
        _fail("mesh active and excluded Allen IDs overlap")

    boundary = document["presentation_boundary"]
    if not math.isfinite(boundary["threshold_um"]):
        _fail("mesh presentation threshold must be finite")
    if document["purpose"] == "production" and boundary["status"] != "reviewed":
        _fail("production mesh cannot use a provisional presentation boundary")
    if boundary["status"] == "provisional-review" and document["purpose"] != "review-only":
        _fail("review boundary requires review-only mesh purpose")
    if boundary["status"] == "provisional-test-only" and document["purpose"] != "test-only":
        _fail("test boundary requires test-only mesh purpose")

    presentations = document["presentations"]
    _unique([item["presentation_id"] for item in presentations], "mesh presentation id")
    _unique([item["signed_allen_id"] for item in presentations], "mesh signed Allen id")
    if [item["presentation_id"] for item in presentations] != list(range(len(presentations))):
        _fail("mesh presentation IDs must be contiguous in manifest order")
    presentation_by_id = {item["presentation_id"]: item for item in presentations}
    signed_by_source: dict[int, set[int]] = {}
    for presentation in presentations:
        source_id = presentation["source_allen_id"]
        signed_id = presentation["signed_allen_id"]
        sign = -1 if presentation["side"] == "left" else 1
        if signed_id != sign * source_id:
            _fail(f"mesh signed Allen identity is inconsistent for presentation {presentation['presentation_id']}")
        if source_id not in active or source_id not in inventory or source_id in excluded:
            _fail(f"mesh presentation {source_id} is outside the declared source scope")
        mappings = presentation["mappings"]
        if mappings["allen"] != signed_id:
            _fail(f"mesh Allen mapping differs from signed identity {signed_id}")
        for name in ("beryl", "cosmos"):
            mapped = mappings[name]
            if mapped is not None and (mapped == sign * 997 or (mapped < 0) != (sign < 0)):
                _fail(f"mesh {name} mapping is invalid for signed identity {signed_id}")
        signed_by_source.setdefault(source_id, set()).add(sign)
    if set(signed_by_source) != set(active):
        _fail("mesh presentation coverage differs from active Allen scope")

    components = document["components"]
    _unique([item["component_id"] for item in components], "mesh component id")
    if [item["component_id"] for item in components] != list(range(len(components))):
        _fail("mesh component IDs must be contiguous in manifest order")
    for component in components:
        source_id = component["source_allen_id"]
        if source_id not in active or source_id not in inventory or source_id in excluded:
            _fail(f"mesh component {component['component_id']} is outside the declared source scope")
        presentation_ids = {
            "left": component["left_presentation_id"],
            "right": component["right_presentation_id"],
        }
        expected_sides = ({"left"} if component["lateralization"] == "left" else
                          {"right"} if component["lateralization"] == "right" else {"left", "right"})
        if {side for side, identifier in presentation_ids.items() if identifier is not None} != expected_sides:
            _fail(f"mesh component presentation sides differ: {component['component_id']}")
        for side, identifier in presentation_ids.items():
            if identifier is not None:
                presentation = presentation_by_id.get(identifier)
                if presentation is None or presentation["source_allen_id"] != source_id or presentation["side"] != side:
                    _fail(f"mesh component presentation identity differs: {component['component_id']}")
        minimum = component["bounds"]["minimum_um"]
        maximum = component["bounds"]["maximum_um"]
        centroid = component["centroid_um"]
        displacement = component["explode_displacement_um"]
        if any(not math.isfinite(value) for value in [*minimum, *maximum, *centroid, *displacement]):
            _fail("mesh bounds, centroids and displacement must be finite")
        if any(low > high or center < low or center > high for low, high, center in zip(minimum, maximum, centroid)):
            _fail(f"mesh centroid or bounds are invalid for component {component['component_id']}")
    if {component["source_allen_id"] for component in components} != set(active):
        _fail("mesh component coverage differs from active Allen scope")

    lods = document["lods"]
    lod_ids = [lod["id"] for lod in lods]
    _unique(lod_ids, "mesh LOD id")
    if document["default_lod_id"] not in lod_ids:
        _fail("mesh default LOD is absent")
    upgrade = document["upgrade_lod_id"]
    if upgrade is not None and (upgrade not in lod_ids or upgrade == document["default_lod_id"]):
        _fail("mesh upgrade LOD is absent or duplicates the default")
    _unique([lod["resource"]["path"] for lod in lods] + [document["validation"]["report"]["path"]], "mesh resource path")
    source_triangles = sum(component["triangle_count"] for component in components)
    for lod in lods:
        if lod["triangle_count"] > source_triangles:
            _fail(f"mesh LOD {lod['id']} exceeds source triangle count")
        if not math.isclose(lod["actual_triangle_ratio"], lod["triangle_count"] / source_triangles, rel_tol=1e-9):
            _fail(f"mesh LOD {lod['id']} triangle ratio is inconsistent")
        decoder = lod["decoder"]
        if decoder["encoding"] == "raw-v1" and (decoder["position_bits"] != 0 or decoder["normal_bits"] != 0):
            _fail("raw mesh LOD cannot declare quantization bits")
        if decoder["encoding"] == "meshopt-quantized-v1" and (decoder["position_bits"] != 14 or decoder["normal_bits"] != 8):
            _fail("meshopt mesh LOD must use the reviewed 14/8-bit quantization")
