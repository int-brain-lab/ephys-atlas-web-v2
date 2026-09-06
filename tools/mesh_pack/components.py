"""Read-only native topology audit; never clips, welds, or assigns presentation IDs."""
from __future__ import annotations

import math
from collections import Counter
from typing import Sequence


def triangle_components(triangles: Sequence[Sequence[int]], *, connectivity: str) -> list[list[int]]:
    """Return source triangle ordinals, ordered by their first source ordinal."""
    if connectivity not in {"edge", "vertex"}:
        raise ValueError("connectivity must be edge or vertex")
    parents = list(range(len(triangles)))

    def root(i: int) -> int:
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    owners: dict[object, int] = {}
    for ordinal, face in enumerate(triangles):
        if len(face) != 3 or any(type(i) is not int or i < 0 for i in face):
            raise ValueError("triangles require three nonnegative integer indices")
        keys = list(face) if connectivity == "vertex" else [tuple(sorted((face[i], face[(i + 1) % 3]))) for i in range(3)]
        for key in keys:
            if key in owners:
                a, b = root(ordinal), root(owners[key])
                parents[max(a, b)] = min(a, b)
            else:
                owners[key] = ordinal
    groups: dict[int, list[int]] = {}
    for ordinal in range(len(triangles)):
        groups.setdefault(root(ordinal), []).append(ordinal)
    return sorted(groups.values(), key=lambda group: group[0])


def audit_surface(positions: Sequence[Sequence[float]], triangles: Sequence[Sequence[int]], *, connectivity: str, tolerance_um: float) -> dict:
    """Classify strictly separated/spanning bounds; retain near-plane ambiguity."""
    if not math.isfinite(tolerance_um) or tolerance_um < 0:
        raise ValueError("tolerance must be finite and nonnegative")
    if any(len(p) != 3 or not all(math.isfinite(v) for v in p) for p in positions):
        raise ValueError("positions must be finite 3-vectors")
    groups = triangle_components(triangles, connectivity=connectivity)
    if any(i >= len(positions) for face in triangles for i in face):
        raise ValueError("triangle index is out of bounds")
    components = []
    for ordinals in groups:
        ids = sorted({i for t in ordinals for i in triangles[t]})
        ml = [positions[i][0] for i in ids]
        low, high = min(ml), max(ml)
        classification = ("left" if high < -tolerance_um else "right" if low > tolerance_um
                          else "neutral" if low < -tolerance_um and high > tolerance_um else "ambiguous")
        components.append({"first_triangle": ordinals[0], "triangle_count": len(ordinals),
                           "vertex_count": len(ids), "ml_bounds_um": [low, high],
                           "minimum_abs_ml_um": min(abs(v) for v in ml),
                           "near_plane_vertex_count": sum(abs(v) <= tolerance_um for v in ml),
                           "classification": classification})
    used = {i for face in triangles for i in face}
    coordinate_counts = Counter(tuple(positions[i]) for i in used)
    degenerate = 0
    for face in triangles:
        a, b, c = (positions[i] for i in face)
        u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
        cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        degenerate += all(value == 0 for value in cross)
    return {"triangle_count": len(triangles), "unused_vertex_count": len(positions)-len(used),
            "duplicate_position_vertex_count": sum(n-1 for n in coordinate_counts.values()),
            "degenerate_triangle_count": degenerate, "components": components,
            "component_counts": dict(sorted(Counter(c["classification"] for c in components).items()))}
