"""Raster-to-SVG geometry with exact and coverage-safe serialization."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import asdict, dataclass
from itertools import pairwise
from typing import Any

import numpy as np
import shapely
from shapely import (
    STRtree,
    box,
    coverage_is_valid,
    coverage_simplify,
    coverage_union_all,
    get_coordinates,
    get_parts,
    points,
    polygonize,
    unary_union,
)
from shapely.geometry import MultiPolygon, Polygon


@dataclass(frozen=True)
class SliceValidation:
    """Scientific and geometric validation for one simplified slice."""

    coverage_valid_before: bool
    coverage_valid_after: bool
    geometries_valid_after: bool
    region_count: int
    components_before: int
    components_after: int
    holes_before: int
    holes_after: int
    adjacency_count_before: int
    adjacency_count_after: int
    adjacency_preserved: bool
    uncovered_voxels: int
    multiply_covered_voxels: int
    wrong_label_voxels: int
    internal_background_components_before: int
    internal_background_components_after: int
    background_topology_valid: bool
    minimum_eligible_region_iou: float
    median_boundary_error_um: float
    p95_boundary_error_um: float
    maximum_boundary_error_um: float
    maximum_boundary_error_upper_bound_um: float
    vertices_before: int
    vertices_after: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _row_runs(row: np.ndarray) -> list[tuple[int, int, int]]:
    """Return ``(label, start, stop)`` runs for a one-dimensional row."""
    if row.size == 0:
        return []
    changes = np.flatnonzero(row[1:] != row[:-1]) + 1
    bounds = np.concatenate(([0], changes, [row.size]))
    return [
        (int(row[start]), int(start), int(stop)) for start, stop in pairwise(bounds)
    ]


def raster_label_geometries(plane: np.ndarray) -> dict[int, Polygon | MultiPolygon]:
    """Convert a label raster to exact cell-edge polygonal coverage.

    Cells are centred on integer plane coordinates, so their boundaries lie on
    half integers. Vertically identical runs are coalesced before conversion;
    this keeps full-corpus generation practical without introducing a raster IO
    dependency. Background label zero is deliberately omitted.
    """
    if plane.ndim != 2:
        raise ValueError("label plane must be two-dimensional")

    rectangles: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    active: dict[tuple[int, int, int], int] = {}
    for row_index, row in enumerate(plane):
        current = {run for run in _row_runs(row) if run[0] != 0}
        for run, first_row in active.items():
            if run not in current:
                label, start, stop = run
                rectangles[label].append(
                    (start - 0.5, first_row - 0.5, stop - 0.5, row_index - 0.5)
                )
        active = {run: active.get(run, row_index) for run in current}

    row_count = plane.shape[0]
    for (label, start, stop), first_row in active.items():
        rectangles[label].append(
            (start - 0.5, first_row - 0.5, stop - 0.5, row_count - 0.5)
        )

    unnoded: list[Polygon | MultiPolygon] = []
    for label in sorted(rectangles):
        cells = np.asarray([box(*bounds) for bounds in rectangles[label]], dtype=object)
        geometry = coverage_union_all(cells)
        if geometry.is_empty:
            continue
        if not isinstance(geometry, (Polygon, MultiPolygon)):
            raise TypeError(f"label {label} produced non-polygonal geometry")
        unnoded.append(geometry)

    # Per-label unions can represent one side of an interface as a long edge
    # while its neighbours divide the other side at T junctions. Node the
    # complete boundary graph once, then polygonize it, so every shared edge
    # has exactly the same vertices on both sides (a GEOS coverage invariant).
    linework = unary_union([geometry.boundary for geometry in unnoded])
    faces = get_parts(polygonize(list(get_parts(linework))))
    by_label: dict[int, list[Polygon]] = defaultdict(list)
    height, width = plane.shape
    for face in faces:
        point = face.representative_point()
        column = min(max(math.floor(point.x + 0.5), 0), width - 1)
        row = min(max(math.floor(point.y + 0.5), 0), height - 1)
        label = int(plane[row, column])
        if label != 0:
            by_label[label].append(face)

    result: dict[int, Polygon | MultiPolygon] = {}
    for label, polygons in sorted(by_label.items()):
        # The Allen raster contains diagonal same-label contacts. A bare
        # MultiPolygon of the polygonized faces is invalid at those contacts;
        # unioning the already globally-noded faces produces valid components
        # without losing the shared vertices introduced above.
        geometry = unary_union(polygons)
        if not isinstance(geometry, (Polygon, MultiPolygon)):
            raise TypeError(f"label {label} produced non-polygonal geometry")
        result[label] = geometry
    return result


def geometry_signature(geometry: Polygon | MultiPolygon) -> tuple[int, int]:
    """Return polygon-component and interior-ring counts for one region."""
    polygons = list(get_parts(geometry))
    return len(polygons), sum(len(polygon.interiors) for polygon in polygons)


def adjacency_pairs(
    geometries: list[Polygon | MultiPolygon],
) -> set[tuple[int, int]]:
    """Return indexes of regions sharing a boundary segment."""
    if not geometries:
        return set()
    tree = STRtree(geometries)
    pairs = tree.query(geometries, predicate="intersects")
    result: set[tuple[int, int]] = set()
    for first, second in zip(pairs[0], pairs[1], strict=True):
        i, j = sorted((int(first), int(second)))
        if i == j or (i, j) in result:
            continue
        if geometries[i].boundary.intersection(geometries[j].boundary).length > 0:
            result.add((i, j))
    return result


def boundary_errors(
    reference: Polygon | MultiPolygon,
    candidate: Polygon | MultiPolygon,
    resolution_um: int,
) -> np.ndarray:
    """Sample symmetric boundary distances in physical units."""
    reference_boundary = shapely.segmentize(reference.boundary, 0.25)
    candidate_boundary = shapely.segmentize(candidate.boundary, 0.25)
    reference_vertices = points(get_coordinates(reference_boundary))
    candidate_vertices = points(get_coordinates(candidate_boundary))
    forward = shapely.distance(reference_vertices, candidate_boundary)
    reverse = shapely.distance(candidate_vertices, reference_boundary)
    return np.concatenate((forward, reverse)) * resolution_um


def voxel_center_errors(
    plane: np.ndarray,
    geometries_by_label: dict[int, Polygon | MultiPolygon],
) -> tuple[int, int, int]:
    """Compare the candidate coverage with every raster voxel centre."""
    coverage_count = np.zeros(plane.shape, dtype=np.uint16)
    correct_label = np.zeros(plane.shape, dtype=bool)
    for label, geometry in geometries_by_label.items():
        min_x, min_y, max_x, max_y = geometry.bounds
        x0 = max(0, math.floor(min_x))
        x1 = min(plane.shape[1], math.ceil(max_x) + 1)
        y0 = max(0, math.floor(min_y))
        y1 = min(plane.shape[0], math.ceil(max_y) + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        inside = np.asarray(
            shapely.covers(geometry, points(xx.reshape(-1), yy.reshape(-1)))
        ).reshape(yy.shape)
        coverage_count[y0:y1, x0:x1] += inside
        correct_label[y0:y1, x0:x1] |= inside & (plane[y0:y1, x0:x1] == label)

    brain = plane != 0
    uncovered = int(np.count_nonzero(brain & ~correct_label))
    multiply_covered = int(np.count_nonzero(coverage_count > 1))
    wrong_label = int(np.count_nonzero((coverage_count > 0) & ~correct_label))
    return uncovered, multiply_covered, wrong_label


def internal_background_components(
    plane: np.ndarray,
    geometries: list[Polygon | MultiPolygon],
) -> int:
    """Count background components enclosed away from the plane boundary."""
    height, width = plane.shape
    frame = box(-0.5, -0.5, width - 0.5, height - 0.5)
    if not geometries:
        return 0
    background = frame.difference(unary_union(geometries))
    return sum(
        1
        for component in get_parts(background)
        if component.boundary.intersection(frame.boundary).is_empty
    )


def simplify_coverage(
    geometries_by_label: dict[int, Polygon | MultiPolygon],
    *,
    source_plane: np.ndarray,
    tolerance_um: float,
    resolution_um: int,
    maximum_error_um: float,
    minimum_iou: float,
    minimum_iou_area_um2: float,
) -> tuple[dict[int, Polygon | MultiPolygon], SliceValidation]:
    """Simplify a complete plane coverage once and enforce scientific gates."""
    if tolerance_um < 0:
        raise ValueError("tolerance_um must be non-negative")
    if resolution_um <= 0:
        raise ValueError("resolution_um must be positive")
    labels = sorted(geometries_by_label)
    exact = [geometries_by_label[label] for label in labels]
    if not exact:
        empty = SliceValidation(
            True,
            True,
            True,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            True,
            0,
            0,
            0,
            0,
            0,
            True,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
            0,
        )
        return {}, empty

    coverage_before = bool(coverage_is_valid(exact))
    if not coverage_before:
        raise ValueError("source raster polygons do not form a valid coverage")
    if tolerance_um == 0:
        candidate = exact
    else:
        simplified = coverage_simplify(
            exact,
            tolerance=tolerance_um / resolution_um,
            simplify_boundary=True,
        )
        candidate = list(simplified)

    coverage_after = bool(coverage_is_valid(candidate))
    valid_after = bool(np.all(shapely.is_valid(candidate)))
    signatures_before = [geometry_signature(geometry) for geometry in exact]
    signatures_after = [geometry_signature(geometry) for geometry in candidate]
    components_before = sum(value[0] for value in signatures_before)
    components_after = sum(value[0] for value in signatures_after)
    holes_before = sum(value[1] for value in signatures_before)
    holes_after = sum(value[1] for value in signatures_after)
    adjacency_before = adjacency_pairs(exact)
    adjacency_after = adjacency_pairs(candidate)
    candidate_by_label = dict(zip(labels, candidate, strict=True))
    uncovered_voxels, multiply_covered_voxels, wrong_label_voxels = (
        voxel_center_errors(source_plane, candidate_by_label)
    )
    internal_background_before = internal_background_components(source_plane, exact)
    internal_background_after = internal_background_components(source_plane, candidate)

    eligible_ious: list[float] = []
    errors: list[np.ndarray] = []
    for reference, simplified_geometry in zip(exact, candidate, strict=True):
        union_area = reference.union(simplified_geometry).area
        iou = (
            1.0
            if union_area == 0
            else reference.intersection(simplified_geometry).area / union_area
        )
        if reference.area * resolution_um**2 >= minimum_iou_area_um2:
            eligible_ious.append(iou)
        errors.append(boundary_errors(reference, simplified_geometry, resolution_um))
    all_errors = np.concatenate(errors) if errors else np.zeros(1)

    validation = SliceValidation(
        coverage_valid_before=coverage_before,
        coverage_valid_after=coverage_after,
        geometries_valid_after=valid_after,
        region_count=len(labels),
        components_before=components_before,
        components_after=components_after,
        holes_before=holes_before,
        holes_after=holes_after,
        adjacency_count_before=len(adjacency_before),
        adjacency_count_after=len(adjacency_after),
        adjacency_preserved=adjacency_before == adjacency_after,
        uncovered_voxels=uncovered_voxels,
        multiply_covered_voxels=multiply_covered_voxels,
        wrong_label_voxels=wrong_label_voxels,
        internal_background_components_before=internal_background_before,
        internal_background_components_after=internal_background_after,
        background_topology_valid=(
            internal_background_before == internal_background_after
        ),
        minimum_eligible_region_iou=float(min(eligible_ious, default=1.0)),
        median_boundary_error_um=float(np.median(all_errors)),
        p95_boundary_error_um=float(np.percentile(all_errors, 95)),
        maximum_boundary_error_um=float(np.max(all_errors)),
        # Sampling at most every quarter voxel bounds an unobserved peak by
        # half the sampling interval because distance to a closed set is
        # 1-Lipschitz.
        maximum_boundary_error_upper_bound_um=float(np.max(all_errors))
        + resolution_um * 0.125,
        vertices_before=sum(
            len(get_coordinates(geometry.boundary)) for geometry in exact
        ),
        vertices_after=sum(
            len(get_coordinates(geometry.boundary)) for geometry in candidate
        ),
    )
    failures: list[str] = []
    if not coverage_after:
        failures.append("coverage")
    if not valid_after:
        failures.append("geometry validity")
    if signatures_before != signatures_after:
        failures.append("components/holes")
    if not validation.adjacency_preserved:
        failures.append("adjacency")
    if uncovered_voxels or multiply_covered_voxels or wrong_label_voxels:
        failures.append(
            "voxel centres "
            f"(uncovered={uncovered_voxels}, multiply-covered={multiply_covered_voxels}, "
            f"wrong-label={wrong_label_voxels})"
        )
    if not validation.background_topology_valid:
        failures.append(
            "internal background components "
            f"{internal_background_before} != {internal_background_after}"
        )
    if validation.minimum_eligible_region_iou < minimum_iou:
        failures.append(
            f"eligible-region IoU {validation.minimum_eligible_region_iou:.6f}"
            f" < {minimum_iou:.6f}"
        )
    if validation.maximum_boundary_error_upper_bound_um > maximum_error_um:
        failures.append(
            "boundary error upper bound "
            f"{validation.maximum_boundary_error_upper_bound_um:.3f} um"
            f" > {maximum_error_um:.3f} um"
        )
    if failures:
        raise ValueError("simplified anatomy failed: " + ", ".join(failures))
    return candidate_by_label, validation


def _without_collinear(coordinates: np.ndarray) -> np.ndarray:
    """Remove only vertices provably between their two collinear neighbours."""
    core = np.asarray(coordinates[:-1], dtype=np.float64)
    if len(core) <= 3:
        return np.vstack((core, core[0]))
    previous = np.roll(core, 1, axis=0)
    following = np.roll(core, -1, axis=0)
    incoming = core - previous
    outgoing = following - core
    cross = incoming[:, 0] * outgoing[:, 1] - incoming[:, 1] * outgoing[:, 0]
    between = np.sum(incoming * outgoing, axis=1) >= 0
    kept = core[~((cross == 0) & between)]
    if len(kept) < 3:
        return np.vstack((core, core[0]))
    return np.vstack((kept, kept[0]))


def validate_exact_coverage(
    geometries_by_label: dict[int, Polygon | MultiPolygon],
    *,
    source_plane: np.ndarray,
) -> tuple[dict[int, Polygon | MultiPolygon], SliceValidation]:
    """Validate exact geometry while avoiding approximate-geometry gates.

    The returned polygons are unchanged. Only their later SVG serialization
    removes mathematically redundant collinear vertices, so raster agreement,
    IoU, adjacency, background topology, and boundary error follow exactly
    rather than requiring an exhaustive approximate comparison.
    """
    labels = sorted(geometries_by_label)
    exact = [geometries_by_label[label] for label in labels]
    if not exact:
        empty = SliceValidation(
            True,
            True,
            True,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            True,
            0,
            0,
            0,
            0,
            0,
            True,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
            0,
        )
        return {}, empty

    coverage_valid = bool(coverage_is_valid(exact))
    geometries_valid = bool(np.all(shapely.is_valid(exact)))
    if not coverage_valid or not geometries_valid:
        raise ValueError("exact anatomy is not a valid polygonal coverage")
    signatures = [geometry_signature(geometry) for geometry in exact]
    adjacency = adjacency_pairs(exact)
    internal_background = internal_background_components(source_plane, exact)
    vertices_before = sum(len(get_coordinates(geometry.boundary)) for geometry in exact)
    vertices_after = sum(
        len(_without_collinear(np.asarray(ring.coords))) - 1
        for geometry in exact
        for polygon in get_parts(geometry)
        for ring in (polygon.exterior, *polygon.interiors)
    )
    validation = SliceValidation(
        coverage_valid_before=True,
        coverage_valid_after=True,
        geometries_valid_after=True,
        region_count=len(labels),
        components_before=sum(value[0] for value in signatures),
        components_after=sum(value[0] for value in signatures),
        holes_before=sum(value[1] for value in signatures),
        holes_after=sum(value[1] for value in signatures),
        adjacency_count_before=len(adjacency),
        adjacency_count_after=len(adjacency),
        adjacency_preserved=True,
        uncovered_voxels=0,
        multiply_covered_voxels=0,
        wrong_label_voxels=0,
        internal_background_components_before=internal_background,
        internal_background_components_after=internal_background,
        background_topology_valid=True,
        minimum_eligible_region_iou=1.0,
        median_boundary_error_um=0.0,
        p95_boundary_error_um=0.0,
        maximum_boundary_error_um=0.0,
        maximum_boundary_error_upper_bound_um=0.0,
        vertices_before=vertices_before,
        vertices_after=vertices_after,
    )
    return geometries_by_label, validation


def _format_coordinate(value: float) -> str:
    doubled = round(float(value) * 2)
    if math.isclose(float(value) * 2, doubled, abs_tol=1e-8):
        return str(doubled // 2) if doubled % 2 == 0 else f"{doubled / 2:.1f}"
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _canonical_ring(coordinates: np.ndarray) -> tuple[tuple[float, float], ...]:
    core = [tuple(map(float, point)) for point in coordinates[:-1]]
    if not core:
        return ()

    def canonical_direction(
        values: list[tuple[float, float]],
    ) -> tuple[tuple[float, float], ...]:
        first = min(range(len(values)), key=lambda index: values[index])
        return tuple(values[first:] + values[:first])

    forward = canonical_direction(core)
    reverse = canonical_direction(list(reversed(core)))
    return min(forward, reverse)


def _ring_path(coordinates: np.ndarray) -> str:
    ring = _canonical_ring(coordinates)
    if len(ring) < 3:
        return ""
    first, *rest = ring
    tail = " ".join(f"{_format_coordinate(x)} {_format_coordinate(y)}" for x, y in rest)
    return (
        f"M{_format_coordinate(first[0])} {_format_coordinate(first[1])}"
        + (f"L{tail}" if tail else "")
        + "Z"
    )


def _compact_coordinate(value: float) -> str:
    text = _format_coordinate(value)
    if text.startswith("0."):
        return text[1:]
    if text.startswith("-0."):
        return "-" + text[2:]
    return text


def _relative_ring_path(coordinates: np.ndarray) -> str:
    ring = _canonical_ring(_without_collinear(coordinates))
    if len(ring) < 3:
        return ""
    first, *rest = ring
    fragments = [f"M{_compact_coordinate(first[0])} {_compact_coordinate(first[1])}"]
    previous = first
    for point in rest:
        dx = point[0] - previous[0]
        dy = point[1] - previous[1]
        if dy == 0:
            fragments.append(f"h{_compact_coordinate(dx)}")
        elif dx == 0:
            fragments.append(f"v{_compact_coordinate(dy)}")
        else:
            fragments.append(f"l{_compact_coordinate(dx)} {_compact_coordinate(dy)}")
        previous = point
    fragments.append("z")
    return "".join(fragments)


def geometry_path(geometry: Polygon | MultiPolygon) -> str:
    """Serialize polygonal geometry to a canonical even-odd SVG path."""
    polygon_paths: list[tuple[tuple[float, float, float, float], str]] = []
    for polygon in get_parts(geometry):
        rings = [_ring_path(np.asarray(polygon.exterior.coords))]
        rings.extend(
            _ring_path(np.asarray(interior.coords)) for interior in polygon.interiors
        )
        path = "".join(sorted(filter(None, rings)))
        polygon_paths.append((tuple(map(float, polygon.bounds)), path))
    return "".join(path for _, path in sorted(polygon_paths))


def geometry_path_relative(geometry: Polygon | MultiPolygon) -> str:
    """Serialize exact polygons with compact relative, collinear-free SVG commands."""
    polygon_paths: list[tuple[tuple[float, float, float, float], str]] = []
    for polygon in get_parts(geometry):
        rings = [_relative_ring_path(np.asarray(polygon.exterior.coords))]
        rings.extend(
            _relative_ring_path(np.asarray(interior.coords))
            for interior in polygon.interiors
        )
        path = "".join(sorted(filter(None, rings)))
        polygon_paths.append((tuple(map(float, polygon.bounds)), path))
    return "".join(path for _, path in sorted(polygon_paths))
