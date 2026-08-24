"""Extract the owner-approved mesh overrides from the canonical bilateral 10 um LUT."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from .canonical_metadata import (
    LABEL_SHAPE,
    ORIGINS_UM,
    SPACING_UM,
    canonical_source_assignment,
)

APPROVED_OVERRIDE_IDS = frozenset({927, 526322264, 599626923})
PINNED_IDENTITIES = {
    "annotation": (
        32_802_468,
        "a9e9654ef491f0af107dc0a61bd720dabe7f36e8f3e9239532bf3dbdc94ef24c",
    ),
    "lut": (
        2_407_680_128,
        "f8c26e2eb972cbff5caa2101fda8b7c5c2a2bdb985e3faad6bf0e57defcc27cb",
    ),
    "catalog": (
        475_154,
        "71a878043aad6c4dbf7a4ca92bd643cad9910984ed81231784e96ff5829afa8b",
    ),
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def _verify(path: Path, identity: tuple[int, str], label: str) -> dict[str, Any]:
    expected_bytes, expected_sha = identity
    if path.stat().st_size != expected_bytes:
        raise ValueError(f"{label} byte size differs from the pinned input")
    actual_sha = _sha256(path)
    if actual_sha != expected_sha:
        raise ValueError(f"{label} SHA-256 differs from the pinned input")
    return {"path": path.name, "bytes": expected_bytes, "sha256": actual_sha}


def validate_override_ids(ids: set[int]) -> None:
    if ids != APPROVED_OVERRIDE_IDS:
        raise ValueError(
            "canonical overrides must contain exactly the owner-approved Allen IDs "
            + ", ".join(str(value) for value in sorted(APPROVED_OVERRIDE_IDS))
        )


def voxel_face_surface(
    mask: np.ndarray, offset: tuple[int, int, int]
) -> tuple[np.ndarray, np.ndarray]:
    """Return a closed, unsmoothed boundary with ambiguous contacts sheet-separated."""
    if mask.ndim != 3 or mask.dtype != np.bool_ or not np.any(mask):
        raise ValueError(
            "surface mask must be a nonempty three-dimensional boolean array"
        )
    padded = np.pad(mask, 1, constant_values=False)
    faces: list[tuple[tuple[int, int, int], list[tuple[int, int, int]]]] = []
    directions = ((0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1))

    for axis, side in directions:
        neighbour = [slice(1, -1)] * 3
        neighbour[axis] = slice(0, -2) if side < 0 else slice(2, None)
        exposed = mask & ~padded[tuple(neighbour)]
        tangent_axes = [candidate for candidate in range(3) if candidate != axis]
        for coordinate in np.argwhere(exposed):
            doubled_center = [2 * int(value) for value in coordinate]
            doubled_center[axis] += side
            corners = []
            for first, second in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                point = doubled_center.copy()
                point[tangent_axes[0]] += first
                point[tangent_axes[1]] += second
                corners.append(tuple(point))
            world = [_world_from_doubled(point, offset) for point in corners]
            normal = np.cross(
                np.subtract(world[1], world[0]), np.subtract(world[2], world[0])
            )
            outward = np.zeros(3)
            world_axis = (1, 0, 2)[axis]
            outward[world_axis] = side * SPACING_UM[world_axis]
            if float(np.dot(normal, outward)) < 0:
                corners.reverse()
            faces.append((tuple(int(value) for value in coordinate), corners))

    # Binary voxel masks can contain diagonal contacts. Four faces then occupy
    # one geometric edge, even though they belong to two distinct boundary
    # sheets. Connect face corners through ordinary two-face edges and pair
    # four-face ambiguities by their owning occupied voxel. Positions stay on
    # the exact same voxel edges; only coincident vertex identities separate.
    parent = list(range(len(faces) * 4))

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def join(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    edges: dict[
        tuple[tuple[int, int, int], tuple[int, int, int]],
        list[tuple[int, tuple[int, int, int], int, int]],
    ] = {}
    for face_index, (owner, corners) in enumerate(faces):
        for corner_index in range(4):
            next_index = (corner_index + 1) % 4
            left, right = corners[corner_index], corners[next_index]
            key = tuple(sorted((left, right)))
            edges.setdefault(key, []).append(
                (
                    face_index,
                    owner,
                    face_index * 4 + corner_index,
                    face_index * 4 + next_index,
                )
            )
    for (left_point, right_point), occurrences in edges.items():
        if len(occurrences) == 2:
            groups = [occurrences]
        elif len(occurrences) == 4:
            by_owner: dict[
                tuple[int, int, int], list[tuple[int, tuple[int, int, int], int, int]]
            ] = {}
            for occurrence in occurrences:
                by_owner.setdefault(occurrence[1], []).append(occurrence)
            groups = list(by_owner.values())
            if sorted(len(group) for group in groups) != [2, 2]:
                raise ValueError(
                    "ambiguous voxel edge cannot be separated by occupied owner"
                )
        else:
            raise ValueError(
                f"voxel boundary edge has unexpected incidence {len(occurrences)}"
            )
        for first, second in groups:
            for point in (left_point, right_point):
                first_node = (
                    first[2] if faces[first[0]][1][first[2] % 4] == point else first[3]
                )
                second_node = (
                    second[2]
                    if faces[second[0]][1][second[2] % 4] == point
                    else second[3]
                )
                join(first_node, second_node)

    vertex_index: dict[int, int] = {}
    vertices: list[tuple[int, int, int]] = []
    triangles: list[tuple[int, int, int]] = []
    for face_index, (_owner, corners) in enumerate(faces):
        indices = []
        for corner_index, point in enumerate(corners):
            root = find(face_index * 4 + corner_index)
            if root not in vertex_index:
                vertex_index[root] = len(vertices)
                vertices.append(point)
            indices.append(vertex_index[root])
        triangles.extend(
            ((indices[0], indices[1], indices[2]), (indices[0], indices[2], indices[3]))
        )

    positions = np.asarray(
        [_world_from_doubled(point, offset) for point in vertices], dtype="<f4"
    )
    faces = np.asarray(triangles, dtype="<u4")
    return positions, faces


def _world_from_doubled(
    point: tuple[int, int, int], offset: tuple[int, int, int]
) -> tuple[float, float, float]:
    ap_index, ml_index, dv_index = (offset[axis] + point[axis] / 2 for axis in range(3))
    return (
        ORIGINS_UM[0] + ml_index * SPACING_UM[0],
        ORIGINS_UM[1] + ap_index * SPACING_UM[1],
        ORIGINS_UM[2] + dv_index * SPACING_UM[2],
    )


def build_overrides(
    lut_path: Path,
    annotation_path: Path,
    catalog_path: Path,
    active_path: Path,
    output: Path,
) -> dict[str, Any]:
    identities = {
        "annotation": _verify(
            annotation_path, PINNED_IDENTITIES["annotation"], "annotation"
        ),
        "lut": _verify(lut_path, PINNED_IDENTITIES["lut"], "bilateral LUT"),
        "catalog": _verify(catalog_path, PINNED_IDENTITIES["catalog"], "Allen catalog"),
    }
    catalog = json.loads(catalog_path.read_bytes())
    active_document = json.loads(active_path.read_bytes())
    source_ids, signed_sources, target_by_row, _scope = canonical_source_assignment(
        catalog, active_document
    )
    validate_override_ids(set(APPROVED_OVERRIDE_IDS))
    if not APPROVED_OVERRIDE_IDS.issubset(source_ids):
        raise ValueError(
            "approved overrides are not all present in the reviewed active source inventory"
        )
    source_index = {value: index + 1 for index, value in enumerate(signed_sources)}
    targets = {
        source_index[(identifier, hemisphere)]: (identifier, hemisphere)
        for identifier in sorted(APPROVED_OVERRIDE_IDS)
        for hemisphere in ("left", "right")
    }

    label = np.load(lut_path, mmap_mode="r")
    if label.shape != LABEL_SHAPE or label.dtype != np.uint16:
        raise ValueError(
            f"expected uint16 LUT {LABEL_SHAPE}, got {label.dtype} {label.shape}"
        )
    bounds = {
        target: [np.full(3, np.iinfo(np.int32).max), np.full(3, -1)]
        for target in targets
    }
    counts = {target: 0 for target in targets}
    for ap_start in range(0, LABEL_SHAPE[0], 8):
        ap_stop = min(ap_start + 8, LABEL_SHAPE[0])
        assigned = target_by_row[np.asarray(label[ap_start:ap_stop])]
        for target in targets:
            coordinates = np.argwhere(assigned == target)
            if not coordinates.size:
                continue
            coordinates[:, 0] += ap_start
            bounds[target][0] = np.minimum(bounds[target][0], coordinates.min(axis=0))
            bounds[target][1] = np.maximum(bounds[target][1], coordinates.max(axis=0))
            counts[target] += coordinates.shape[0]
        if ap_stop % 160 == 0 or ap_stop == LABEL_SHAPE[0]:
            print(
                f"canonical overrides: scanned {ap_stop}/{LABEL_SHAPE[0]} AP planes",
                flush=True,
            )

    output.mkdir(parents=True, exist_ok=True)
    surfaces = []
    for target, (identifier, hemisphere) in sorted(targets.items()):
        if counts[target] == 0:
            raise ValueError(
                f"approved override {identifier} {hemisphere} has no canonical voxels"
            )
        minimum, maximum = bounds[target]
        slices = tuple(
            slice(int(minimum[axis]), int(maximum[axis]) + 1) for axis in range(3)
        )
        mask = target_by_row[np.asarray(label[slices])] == target
        positions, triangles = voxel_face_surface(
            mask, tuple(int(value) for value in minimum)
        )
        sign = -1 if hemisphere == "left" else 1
        stem = str(sign * identifier)
        position_path = f"{stem}.positions.f32"
        index_path = f"{stem}.indices.u32"
        position_bytes = positions.tobytes(order="C")
        index_bytes = triangles.tobytes(order="C")
        (output / position_path).write_bytes(position_bytes)
        (output / index_path).write_bytes(index_bytes)
        surface_hash = hashlib.sha256(position_bytes + index_bytes).hexdigest()
        surfaces.append(
            {
                "source_allen_id": identifier,
                "signed_allen_id": sign * identifier,
                "hemisphere": hemisphere,
                "voxel_count": counts[target],
                "voxel_bounds_inclusive": {
                    "minimum": minimum.tolist(),
                    "maximum": maximum.tolist(),
                },
                "vertex_count": int(positions.shape[0]),
                "triangle_count": int(triangles.shape[0]),
                "surface_sha256": surface_hash,
                "positions": _resource(
                    position_path,
                    position_bytes,
                    [int(positions.shape[0]), 3],
                    "float32",
                ),
                "indices": _resource(
                    index_path, index_bytes, [int(triangles.shape[0]), 3], "uint32"
                ),
            }
        )
    del label
    manifest = {
        "format": "atlas-mesh-canonical-overrides-v1",
        "method": "exact exposed-voxel-face boundary on canonical 10 um bilateral LUT masks; half-index voxel edges; no smoothing, filling, or manual repair",
        "approved_positive_allen_ids": sorted(APPROVED_OVERRIDE_IDS),
        "inputs": {
            **identities,
            "active_inventory": {
                "path": active_path.name,
                "bytes": active_path.stat().st_size,
                "sha256": _sha256(active_path),
            },
        },
        "surfaces": surfaces,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    return manifest


def _resource(path: str, data: bytes, shape: list[int], dtype: str) -> dict[str, Any]:
    return {
        "path": path,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "dtype": dtype,
        "shape": shape,
        "endianness": "little",
        "order": "C",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lut", type=Path, required=True)
    parser.add_argument("--annotation", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--active-inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    manifest = build_overrides(
        arguments.lut,
        arguments.annotation,
        arguments.catalog,
        arguments.active_inventory,
        arguments.output,
    )
    print(
        json.dumps(
            {
                "signed_surfaces": len(manifest["surfaces"]),
                "output": str(arguments.output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
